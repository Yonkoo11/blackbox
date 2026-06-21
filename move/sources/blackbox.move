/// Blackbox — the accountability layer for autonomous AI agents on Sui.
///
/// An `AgentVault` is a SHARED object that custodies an agent's capital and anchors a
/// tamper-evident memory hash-chain. The agent (a delegate key) can move money ONLY through
/// `spend_and_record`, which enforces the spend policy ON-CHAIN (Move aborts an over-limit,
/// over-rate, disallowed-recipient, or out-of-window action) and appends a memory entry atomically.
/// Each action's payload is Seal-encrypted off-chain and stored as a Walrus blob; only the blob id
/// and a content hash are committed here. An off-chain verifier recomputes the chain from the Walrus
/// blobs and compares against `head_hash`, so any edit to a stored payload is detectable.
module blackbox::blackbox;

use std::string::String;
use sui::bcs;
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;
use sui::hash;
use sui::sui::SUI;
use sui::vec_set::{Self, VecSet};

// === Errors ===
const ENotActive: u64 = 0;
const EWindowClosed: u64 = 1;
const EOverSpendLimit: u64 = 2;
const ENotAgent: u64 = 3;
const EWrongVault: u64 = 4;
const EInsufficientBalance: u64 = 5;
const ENoAccess: u64 = 6;
const EOverRateLimit: u64 = 7;
const ERecipientNotAllowed: u64 = 8;

// === Objects ===

/// Shared, publicly-verifiable agent vault: custody + on-chain spend policy + memory chain anchor.
public struct AgentVault has key {
    id: UID,
    owner: address,                  // operator who administers via OwnerCap
    agent: address,                  // delegate key address authorized to act
    funds: Balance<SUI>,             // custodied capital; only exits via spend_and_record
    // lifetime cap
    spend_limit: u64,                // max cumulative value the agent may ever move
    spent: u64,                      // cumulative value moved so far
    // rolling-window rate cap (tumbling window). window_ms == 0 disables it.
    window_ms: u64,
    rate_limit: u64,                 // max value movable within one window
    window_start_ms: u64,
    window_spent: u64,
    // destination control
    recipients_restricted: bool,
    allowed_recipients: VecSet<address>,
    // policy validity + lifecycle
    expires_at_ms: u64,              // policy window end (0 = no expiry)
    active: bool,
    // verifiable memory
    head_hash: vector<u8>,           // keccak256 hash-chain head over all recorded actions
    count: u64,
    viewers: VecSet<address>,        // Seal decryption allowlist (in addition to owner)
}

/// Owned capability proving operator authority over one vault.
public struct OwnerCap has key, store {
    id: UID,
    vault: ID,
}

// === Events ===
public struct VaultCreated has copy, drop {
    vault: ID,
    owner: address,
    agent: address,
    spend_limit: u64,
    rate_limit: u64,
    window_ms: u64,
}

public struct ActionRecorded has copy, drop {
    vault: ID,
    seq: u64,
    amount: u64,
    recipient: address,
    blob_id: String,
    entry_hash: vector<u8>,
}

// === Create ===

/// Create and share a vault funded with `initial`, returning an `OwnerCap` to the caller.
/// `window_ms`/`rate_limit` define a rolling rate cap (set window_ms = 0 to disable).
public fun create_vault(
    initial: Coin<SUI>,
    agent: address,
    spend_limit: u64,
    window_ms: u64,
    rate_limit: u64,
    expires_at_ms: u64,
    ctx: &mut TxContext,
): OwnerCap {
    let id = object::new(ctx);
    let vault_id = id.to_inner();
    let vault = AgentVault {
        id,
        owner: ctx.sender(),
        agent,
        funds: initial.into_balance(),
        spend_limit,
        spent: 0,
        window_ms,
        rate_limit,
        window_start_ms: 0,
        window_spent: 0,
        recipients_restricted: false,
        allowed_recipients: vec_set::empty(),
        expires_at_ms,
        active: true,
        head_hash: vector::empty(),
        count: 0,
        viewers: vec_set::empty(),
    };
    event::emit(VaultCreated { vault: vault_id, owner: ctx.sender(), agent, spend_limit, rate_limit, window_ms });
    transfer::share_object(vault);
    OwnerCap { id: object::new(ctx), vault: vault_id }
}

// === Agent actions ===

/// THE guardrail: the agent moves money ONLY through this recorded, capped, rate-limited path.
public fun spend_and_record(
    vault: &mut AgentVault,
    amount: u64,
    recipient: address,
    blob_id: String,
    content_hash: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(ctx.sender() == vault.agent, ENotAgent);
    assert!(vault.active, ENotActive);
    let now = clock.timestamp_ms();
    if (vault.expires_at_ms != 0) {
        assert!(now <= vault.expires_at_ms, EWindowClosed);
    };

    // destination control
    if (vault.recipients_restricted) {
        assert!(vault.allowed_recipients.contains(&recipient), ERecipientNotAllowed);
    };

    // lifetime cap
    assert!(vault.spent + amount <= vault.spend_limit, EOverSpendLimit);

    // rolling-window rate cap (tumbling): reset the window once it has elapsed
    if (vault.window_ms != 0) {
        if (now >= vault.window_start_ms + vault.window_ms) {
            vault.window_start_ms = now;
            vault.window_spent = 0;
        };
        assert!(vault.window_spent + amount <= vault.rate_limit, EOverRateLimit);
        vault.window_spent = vault.window_spent + amount;
    };

    assert!(balance::value(&vault.funds) >= amount, EInsufficientBalance);

    vault.spent = vault.spent + amount;
    let paid = coin::take(&mut vault.funds, amount, ctx);
    transfer::public_transfer(paid, recipient);

    append_entry(vault, amount, recipient, blob_id, content_hash);
}

/// Record a non-financial memory step (observation / reasoning). amount = 0; not rate/recipient gated.
public fun record_note(
    vault: &mut AgentVault,
    blob_id: String,
    content_hash: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(ctx.sender() == vault.agent, ENotAgent);
    assert!(vault.active, ENotActive);
    if (vault.expires_at_ms != 0) {
        assert!(clock.timestamp_ms() <= vault.expires_at_ms, EWindowClosed);
    };
    let agent = vault.agent;
    append_entry(vault, 0, agent, blob_id, content_hash);
}

fun append_entry(
    vault: &mut AgentVault,
    amount: u64,
    recipient: address,
    blob_id: String,
    content_hash: vector<u8>,
) {
    let seq = vault.count;
    let entry_hash = compute_entry_hash(&vault.head_hash, &content_hash, amount, seq);
    vault.head_hash = entry_hash;
    vault.count = seq + 1;
    event::emit(ActionRecorded {
        vault: object::id(vault),
        seq,
        amount,
        recipient,
        blob_id,
        entry_hash,
    });
}

/// Deterministic entry hash — the verifier reruns this off-chain over the Walrus blobs.
public fun compute_entry_hash(
    prev_head: &vector<u8>,
    content_hash: &vector<u8>,
    amount: u64,
    seq: u64,
): vector<u8> {
    let mut preimage = vector::empty<u8>();
    preimage.append(*prev_head);
    preimage.append(*content_hash);
    preimage.append(bcs::to_bytes(&amount));
    preimage.append(bcs::to_bytes(&seq));
    hash::keccak256(&preimage)
}

// === Seal access policy ===

/// Seal key servers dry-run this; access is granted iff it does NOT abort.
/// `id` must be namespaced by the vault's object id (prevents cross-vault key reuse),
/// and the requester must be the vault owner or an allowlisted viewer (auditor).
entry fun seal_approve(id: vector<u8>, vault: &AgentVault, ctx: &TxContext) {
    assert!(can_access(vault, &id, ctx.sender()), ENoAccess);
}

/// Pure, testable access predicate behind `seal_approve`.
public fun can_access(vault: &AgentVault, id: &vector<u8>, requester: address): bool {
    is_prefix(&vault.id.to_bytes(), id)
        && (requester == vault.owner || vault.viewers.contains(&requester))
}

fun is_prefix(prefix: &vector<u8>, full: &vector<u8>): bool {
    let plen = vector::length(prefix);
    if (plen > vector::length(full)) return false;
    let mut i = 0;
    while (i < plen) {
        if (*vector::borrow(prefix, i) != *vector::borrow(full, i)) return false;
        i = i + 1;
    };
    true
}

// === Admin (OwnerCap-gated) ===

public fun add_viewer(cap: &OwnerCap, vault: &mut AgentVault, viewer: address) {
    assert!(cap.vault == object::id(vault), EWrongVault);
    vault.viewers.insert(viewer);
}

public fun remove_viewer(cap: &OwnerCap, vault: &mut AgentVault, viewer: address) {
    assert!(cap.vault == object::id(vault), EWrongVault);
    vault.viewers.remove(&viewer);
}

/// Turn the recipient allowlist on/off.
public fun set_recipient_restriction(cap: &OwnerCap, vault: &mut AgentVault, restricted: bool) {
    assert!(cap.vault == object::id(vault), EWrongVault);
    vault.recipients_restricted = restricted;
}

public fun add_recipient(cap: &OwnerCap, vault: &mut AgentVault, recipient: address) {
    assert!(cap.vault == object::id(vault), EWrongVault);
    vault.allowed_recipients.insert(recipient);
}

public fun remove_recipient(cap: &OwnerCap, vault: &mut AgentVault, recipient: address) {
    assert!(cap.vault == object::id(vault), EWrongVault);
    vault.allowed_recipients.remove(&recipient);
}

/// Adjust the rolling rate cap (window_ms = 0 disables rate limiting).
public fun set_rate_limit(cap: &OwnerCap, vault: &mut AgentVault, window_ms: u64, rate_limit: u64) {
    assert!(cap.vault == object::id(vault), EWrongVault);
    vault.window_ms = window_ms;
    vault.rate_limit = rate_limit;
}

/// Kill switch — freezes all agent actions.
public fun deactivate(cap: &OwnerCap, vault: &mut AgentVault) {
    assert!(cap.vault == object::id(vault), EWrongVault);
    vault.active = false;
}

/// Anyone may add funds to a vault.
public fun top_up(vault: &mut AgentVault, c: Coin<SUI>) {
    balance::join(&mut vault.funds, c.into_balance());
}

/// Owner withdraws remaining funds (e.g. after deactivation).
public fun withdraw(
    cap: &OwnerCap,
    vault: &mut AgentVault,
    amount: u64,
    ctx: &mut TxContext,
): Coin<SUI> {
    assert!(cap.vault == object::id(vault), EWrongVault);
    coin::take(&mut vault.funds, amount, ctx)
}

// === Views ===
public fun head_hash(v: &AgentVault): vector<u8> { v.head_hash }
public fun count(v: &AgentVault): u64 { v.count }
public fun spent(v: &AgentVault): u64 { v.spent }
public fun spend_limit(v: &AgentVault): u64 { v.spend_limit }
public fun remaining(v: &AgentVault): u64 { v.spend_limit - v.spent }
public fun rate_limit(v: &AgentVault): u64 { v.rate_limit }
public fun window_ms(v: &AgentVault): u64 { v.window_ms }
public fun window_spent(v: &AgentVault): u64 { v.window_spent }
public fun recipients_restricted(v: &AgentVault): bool { v.recipients_restricted }
public fun is_recipient_allowed(v: &AgentVault, r: address): bool { v.allowed_recipients.contains(&r) }
public fun balance_value(v: &AgentVault): u64 { balance::value(&v.funds) }
public fun is_active(v: &AgentVault): bool { v.active }
public fun owner(v: &AgentVault): address { v.owner }
public fun agent(v: &AgentVault): address { v.agent }
