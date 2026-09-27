/// Synthetic zero-decimal bond units. No legal claim or redemption rights.
module tradebridge::demo_bond;
use sui::coin_registry;
public struct DEMO_BOND has drop {}
fun init(witness: DEMO_BOND, ctx: &mut TxContext) {
    let (initializer, cap) = coin_registry::new_currency_with_otw(witness, 0, std::string::utf8(b"DEMOBOND"), std::string::utf8(b"TradeBridge simulated bond"), std::string::utf8(b"Synthetic test asset. No real-world value or rights."), std::string::utf8(b""), ctx);
    coin_registry::finalize_and_delete_metadata_cap(initializer, ctx);
    transfer::public_transfer(cap, ctx.sender());
}
