/// Synthetic two-decimal cash. Not USDC, fiat or a redeemable stablecoin.
module tradebridge::demo_usd;
use sui::coin_registry;
public struct DEMO_USD has drop {}
fun init(witness: DEMO_USD, ctx: &mut TxContext) {
    let (initializer, cap) = coin_registry::new_currency_with_otw(witness, 2, std::string::utf8(b"DEMOUSD"), std::string::utf8(b"TradeBridge simulated cash"), std::string::utf8(b"Synthetic test asset. No real-world value or redemption."), std::string::utf8(b""), ctx);
    coin_registry::finalize_and_delete_metadata_cap(initializer, ctx);
    transfer::public_transfer(cap, ctx.sender());
}
