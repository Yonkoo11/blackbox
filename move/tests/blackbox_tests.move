#[test_only]
module blackbox::blackbox_tests;

use blackbox::blackbox::{Self, AgentVault};
use sui::clock;
use sui::coin;
use sui::sui::SUI;
use sui::test_scenario as ts;

const OWNER: address = @0xA1;
const AGENT: address = @0xB2;
const RECIP: address = @0xC3;

fun mint(amount: u64, sc: &mut ts::Scenario): coin::Coin<SUI> {
    coin::mint_for_testing<SUI>(amount, sc.ctx())
}

#[test]
fun spend_records_and_chains() {
    let mut sc = ts::begin(OWNER);
    let cap = blackbox::create_vault(mint(1000, &mut sc), AGENT, 100, 0, sc.ctx());
    transfer::public_transfer(cap, OWNER);

    sc.next_tx(AGENT);
    let mut vault = ts::take_shared<AgentVault>(&sc);
    let clk = clock::create_for_testing(sc.ctx());

    let h0 = blackbox::head_hash(&vault); // empty
    blackbox::spend_and_record(&mut vault, 40, RECIP, b"blobA".to_string(), b"hashA", &clk, sc.ctx());
    let h1 = blackbox::head_hash(&vault);
    blackbox::record_note(&mut vault, b"blobB".to_string(), b"hashB", &clk, sc.ctx());
    let h2 = blackbox::head_hash(&vault);

    assert!(blackbox::count(&vault) == 2, 100);
    assert!(blackbox::spent(&vault) == 40, 101);          // note() does not spend
    assert!(blackbox::remaining(&vault) == 60, 102);
    assert!(blackbox::balance_value(&vault) == 960, 103); // 1000 - 40 paid out
    assert!(h0 != h1, 104);
    assert!(h1 != h2, 105);
    // off-chain verifier recomputes entry 0 and must match the on-chain head after it
    let recomputed_h1 = blackbox::compute_entry_hash(&h0, &b"hashA", 40, 0);
    assert!(recomputed_h1 == h1, 106);

    clock::destroy_for_testing(clk);
    ts::return_shared(vault);
    sc.end();
}

#[test]
#[expected_failure(abort_code = 2, location = blackbox)] // EOverSpendLimit
fun over_limit_aborts() {
    let mut sc = ts::begin(OWNER);
    let cap = blackbox::create_vault(mint(1000, &mut sc), AGENT, 100, 0, sc.ctx());
    transfer::public_transfer(cap, OWNER);

    sc.next_tx(AGENT);
    let mut vault = ts::take_shared<AgentVault>(&sc);
    let clk = clock::create_for_testing(sc.ctx());

    blackbox::spend_and_record(&mut vault, 60, RECIP, b"b1".to_string(), b"h1", &clk, sc.ctx());
    // 60 + 50 = 110 > 100 → guardrail aborts the whole tx (funds never move)
    blackbox::spend_and_record(&mut vault, 50, RECIP, b"b2".to_string(), b"h2", &clk, sc.ctx());

    clock::destroy_for_testing(clk);
    ts::return_shared(vault);
    sc.end();
}

#[test]
#[expected_failure(abort_code = 3, location = blackbox)] // ENotAgent
fun non_agent_cannot_spend() {
    let mut sc = ts::begin(OWNER);
    let cap = blackbox::create_vault(mint(1000, &mut sc), AGENT, 100, 0, sc.ctx());
    transfer::public_transfer(cap, OWNER);

    sc.next_tx(RECIP); // not the agent
    let mut vault = ts::take_shared<AgentVault>(&sc);
    let clk = clock::create_for_testing(sc.ctx());
    blackbox::spend_and_record(&mut vault, 1, RECIP, b"b".to_string(), b"h", &clk, sc.ctx());

    clock::destroy_for_testing(clk);
    ts::return_shared(vault);
    sc.end();
}

#[test]
#[expected_failure(abort_code = 0, location = blackbox)] // ENotActive
fun deactivated_blocks_action() {
    let mut sc = ts::begin(OWNER);
    let cap = blackbox::create_vault(mint(1000, &mut sc), AGENT, 100, 0, sc.ctx());

    sc.next_tx(OWNER);
    let mut vault = ts::take_shared<AgentVault>(&sc);
    blackbox::deactivate(&cap, &mut vault);
    ts::return_shared(vault);
    transfer::public_transfer(cap, OWNER);

    sc.next_tx(AGENT);
    let mut vault2 = ts::take_shared<AgentVault>(&sc);
    let clk = clock::create_for_testing(sc.ctx());
    blackbox::record_note(&mut vault2, b"b".to_string(), b"h", &clk, sc.ctx()); // aborts ENotActive

    clock::destroy_for_testing(clk);
    ts::return_shared(vault2);
    sc.end();
}

#[test]
fun seal_access_policy() {
    let mut sc = ts::begin(OWNER);
    let cap = blackbox::create_vault(mint(1000, &mut sc), AGENT, 100, 0, sc.ctx());

    sc.next_tx(OWNER);
    let mut vault = ts::take_shared<AgentVault>(&sc);

    // id correctly namespaced by the vault's object id
    let mut good_id = object::id(&vault).to_bytes();
    good_id.push_back(0xAB); // append a nonce byte

    // owner can access; stranger cannot; agent (not a viewer) cannot
    assert!(blackbox::can_access(&vault, &good_id, OWNER), 300);
    assert!(!blackbox::can_access(&vault, &good_id, RECIP), 301);
    assert!(!blackbox::can_access(&vault, &good_id, AGENT), 302);

    // wrong namespace (id not prefixed by this vault's id) is denied even for the owner
    let bad_id = b"not-this-vault".to_string().into_bytes();
    assert!(!blackbox::can_access(&vault, &bad_id, OWNER), 303);

    // after allowlisting, the viewer (auditor) can access
    blackbox::add_viewer(&cap, &mut vault, RECIP);
    assert!(blackbox::can_access(&vault, &good_id, RECIP), 304);
    // and removing revokes it
    blackbox::remove_viewer(&cap, &mut vault, RECIP);
    assert!(!blackbox::can_access(&vault, &good_id, RECIP), 305);

    ts::return_shared(vault);
    transfer::public_transfer(cap, OWNER);
    sc.end();
}

#[test]
fun owner_can_view_deactivate_and_withdraw() {
    let mut sc = ts::begin(OWNER);
    let cap = blackbox::create_vault(mint(1000, &mut sc), AGENT, 100, 0, sc.ctx());

    sc.next_tx(OWNER);
    let mut vault = ts::take_shared<AgentVault>(&sc);
    blackbox::add_viewer(&cap, &mut vault, RECIP);
    blackbox::deactivate(&cap, &mut vault);
    assert!(!blackbox::is_active(&vault), 200);
    let refund = blackbox::withdraw(&cap, &mut vault, 1000, sc.ctx());
    assert!(coin::value(&refund) == 1000, 201);
    transfer::public_transfer(refund, OWNER);

    ts::return_shared(vault);
    transfer::public_transfer(cap, OWNER);
    sc.end();
}
