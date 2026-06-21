/// Blackbox — guardrails + verifiable flight recorder for autonomous AI agents.
///
/// An `AgentCap` is an owned Sui object the operator holds. It encodes a spending
/// policy that Move enforces ON-CHAIN (an over-limit action aborts the transaction —
/// no trust in the agent required), and it anchors a hash-chain over every action the
/// agent takes. Each action's payload (the agent's reasoning/observation) is
/// Seal-encrypted off-chain and stored as a Walrus blob; only the blob id and a
/// content hash are committed here, making the memory tamper-evident: an off-chain
/// verifier recomputes the chain from the Walrus blobs and compares against `head_hash`.
module blackbox::blackbox;

use std::string::String;
use sui::bcs;
use sui::clock::Clock;
use sui::event;
use sui::hash;

// === Errors ===
const ENotActive: u64 = 0;
const EWindowClosed: u64 = 1;
const EOverSpendLimit: u64 = 2;
const ENotOwner: u64 = 3;

// === Objects ===

/// Capability + memory anchor for a single agent. Owned by the operator.
public struct AgentCap has key, store {
    id: UID,
    owner: address,
    /// max cumulative value the agent may move under this policy
    spend_limit: u64,
    /// cumulative value moved so far
    spent: u64,
    /// policy window end in ms (0 = no expiry)
    expires_at_ms: u64,
    active: bool,
    /// keccak256 hash-chain head over all recorded actions
    head_hash: vector<u8>,
    /// number of actions recorded
    count: u64,
}

// === Events ===

/// Emitted on every recorded action — off-chain indexers/verifier consume this.
public struct ActionRecorded has copy, drop {
    cap: ID,
    seq: u64,
    amount: u64,
    blob_id: String,
    entry_hash: vector<u8>,
}

// === Public API ===

/// Create an agent capability with a spending policy and transfer it to the caller.
public fun create_agent(spend_limit: u64, expires_at_ms: u64, ctx: &mut TxContext) {
    transfer::transfer(new_agent(spend_limit, expires_at_ms, ctx), ctx.sender());
}

/// Construct an `AgentCap` (used by `create_agent` and tests).
public fun new_agent(spend_limit: u64, expires_at_ms: u64, ctx: &mut TxContext): AgentCap {
    AgentCap {
        id: object::new(ctx),
        owner: ctx.sender(),
        spend_limit,
        spent: 0,
        expires_at_ms,
        active: true,
        head_hash: vector::empty(),
        count: 0,
    }
}

/// Record an agent action and enforce the spend policy atomically.
///
/// `amount`       value moved by this action (0 for non-financial steps)
/// `blob_id`      Walrus blob id of the Seal-encrypted step payload
/// `content_hash` keccak256 of the encrypted payload, committed on-chain
///
/// Aborts (whole tx reverts) if the policy is violated — this is the guardrail.
public fun record_action(
    cap: &mut AgentCap,
    amount: u64,
    blob_id: String,
    content_hash: vector<u8>,
    clock: &Clock,
) {
    assert!(cap.active, ENotActive);
    if (cap.expires_at_ms != 0) {
        assert!(clock.timestamp_ms() <= cap.expires_at_ms, EWindowClosed);
    };
    // GUARDRAIL: the agent physically cannot exceed its on-chain limit.
    assert!(cap.spent + amount <= cap.spend_limit, EOverSpendLimit);
    cap.spent = cap.spent + amount;

    // TAMPER-EVIDENCE: entry_hash = keccak256(prev_head || content_hash || amount || seq)
    let seq = cap.count;
    let entry_hash = compute_entry_hash(&cap.head_hash, &content_hash, amount, seq);

    cap.head_hash = entry_hash;
    cap.count = seq + 1;

    event::emit(ActionRecorded { cap: object::id(cap), seq, amount, blob_id, entry_hash });
}

/// Deterministic entry hash — the verifier reruns this off-chain over Walrus blobs.
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

/// Owner can freeze the agent (kill switch).
public fun deactivate(cap: &mut AgentCap, ctx: &TxContext) {
    assert!(cap.owner == ctx.sender(), ENotOwner);
    cap.active = false;
}

// === Views ===
public fun head_hash(cap: &AgentCap): vector<u8> { cap.head_hash }
public fun count(cap: &AgentCap): u64 { cap.count }
public fun spent(cap: &AgentCap): u64 { cap.spent }
public fun spend_limit(cap: &AgentCap): u64 { cap.spend_limit }
public fun remaining(cap: &AgentCap): u64 { cap.spend_limit - cap.spent }
public fun is_active(cap: &AgentCap): bool { cap.active }

// === Test-only helpers ===
#[test_only]
public fun destroy_for_test(cap: AgentCap) {
    let AgentCap { id, owner: _, spend_limit: _, spent: _, expires_at_ms: _, active: _, head_hash: _, count: _ } = cap;
    id.delete();
}
