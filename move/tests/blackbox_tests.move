#[test_only]
module blackbox::blackbox_tests;

use blackbox::blackbox::{Self, AgentCap};
use sui::clock;
use sui::test_scenario as ts;

const OPERATOR: address = @0xA1;

#[test]
fun records_chain_and_links() {
    let mut sc = ts::begin(OPERATOR);
    let ctx = sc.ctx();
    let mut cap = blackbox::new_agent(100, 0, ctx);
    let clk = clock::create_for_testing(ctx);

    let h0 = blackbox::head_hash(&cap); // empty
    blackbox::record_action(&mut cap, 40, b"blobA".to_string(), b"hashA", &clk);
    let h1 = blackbox::head_hash(&cap);
    blackbox::record_action(&mut cap, 50, b"blobB".to_string(), b"hashB", &clk);
    let h2 = blackbox::head_hash(&cap);

    assert!(blackbox::count(&cap) == 2, 100);
    assert!(blackbox::spent(&cap) == 90, 101);
    assert!(blackbox::remaining(&cap) == 10, 102);
    // chain links: each head differs from the last
    assert!(h0 != h1, 103);
    assert!(h1 != h2, 104);
    // off-chain verifier recomputes entry 1 and must match on-chain head after entry 0
    let recomputed_h1 = blackbox::compute_entry_hash(&h0, &b"hashA", 40, 0);
    assert!(recomputed_h1 == h1, 105);

    clock::destroy_for_testing(clk);
    blackbox::destroy_for_test(cap);
    sc.end();
}

#[test]
#[expected_failure(abort_code = 2, location = blackbox)] // EOverSpendLimit
fun over_limit_aborts() {
    let mut sc = ts::begin(OPERATOR);
    let ctx = sc.ctx();
    let mut cap = blackbox::new_agent(100, 0, ctx);
    let clk = clock::create_for_testing(ctx);

    blackbox::record_action(&mut cap, 60, b"b1".to_string(), b"h1", &clk);
    // 60 + 50 = 110 > 100 → guardrail aborts the whole tx
    blackbox::record_action(&mut cap, 50, b"b2".to_string(), b"h2", &clk);

    clock::destroy_for_testing(clk);
    blackbox::destroy_for_test(cap);
    sc.end();
}

#[test]
#[expected_failure(abort_code = 0, location = blackbox)] // ENotActive
fun deactivated_blocks_record() {
    let mut sc = ts::begin(OPERATOR);
    let ctx = sc.ctx();
    let mut cap = blackbox::new_agent(100, 0, ctx);
    let clk = clock::create_for_testing(ctx);

    blackbox::deactivate(&mut cap, sc.ctx());
    blackbox::record_action(&mut cap, 1, b"b".to_string(), b"h", &clk);

    clock::destroy_for_testing(clk);
    blackbox::destroy_for_test(cap);
    sc.end();
}
