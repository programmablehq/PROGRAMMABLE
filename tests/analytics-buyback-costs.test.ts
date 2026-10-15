import { describe, expect, it } from "vitest";
import { completeBuybackCosts, decodeRelayBuybackInput, unpricedBuybacks } from "@/lib/analytics/buyback-costs";
import { PRIMARY_BUYBACK_WALLET, type QueryResult } from "@/lib/analytics/model";

const proxy="0xccc88a9d1b4ed6b0eaba998850414b24f1c315be", router="0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f";
const usdg="0x5fc5360d0400a0fd4f2af552add042d716f1d168", v4="0xc60ba256b44334a0cd2c7242e98b88f031abb006", funding="0xf70da97812cb96acdf810712aa562db8dfa3dbef";
const transfer="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", funds="0xafbab204e8271965231d37baed9b1abca8725b7409c70314455f68bc89142b91";
const hash=`0x${"1".repeat(64)}`, at="2026-10-15T10:52:09.000Z";
const word=(value: string|bigint)=>typeof value === "bigint" ? value.toString(16).padStart(64,"0") : value.slice(2).padStart(64,"0");
const payment=(asset:string,from:string,to:string,amount:bigint)=>({address:asset,topics:[transfer,`0x${word(from)}`,`0x${word(to)}`],data:`0x${word(amount)}`});
const movement=(emitter:string,from:string,to:string,asset:string,amount:bigint)=>({address:emitter,topics:[funds],data:`0x${word(from)}${word(to)}${word(asset)}${word(amount)}`});
const request={hash,at,amount:100,block:89167056};
const receipt=()=>({transactionHash:hash,status:"0x1",blockNumber:`0x${request.block.toString(16)}`,to:proxy,logs:[movement(proxy,funding,router,usdg,10_000_000n),movement(router,router,PRIMARY_BUYBACK_WALLET,v4,100n*10n**18n),payment(usdg,funding,router,10_000_000n),payment(v4,router,PRIMARY_BUYBACK_WALLET,100n*10n**18n)]});
const result=():QueryResult=>({available:true,updatedAt:at,rows:[{unpriced_buybacks:1,buybacks_usd:null,buybacks_priced_subtotal_usd:50,transaction_audit:`4663|${hash.slice(2)}|100|0|0`,buyback_events_v1:`4663|${hash.slice(2)}|100|${at}|${request.block}`}]});

describe("historical Relay buyback cost",()=>{
  it("requires the exact payment and actual V4 delivery, rather than a transfer or event alone",()=>{
    expect(decodeRelayBuybackInput(request,receipt())?.units).toBe(10);
    const noPayment=receipt();noPayment.logs.splice(2,1);
    expect(decodeRelayBuybackInput(request,noPayment)).toBeNull();
    const noDelivery=receipt();noDelivery.logs.pop();
    expect(decodeRelayBuybackInput(request,noDelivery)).toBeNull();
    expect(decodeRelayBuybackInput({...request,block:1},receipt())).toBeNull();
    expect(decodeRelayBuybackInput({...request,amount:200},receipt())).toBeNull();
  });
  it("deducts refunds without charging internal wallet movements as purchases",()=>{
    const r=receipt();r.logs.push(payment(usdg,router,funding,2_000_000n));
    r.logs.push(payment(v4,PRIMARY_BUYBACK_WALLET,"0x39544a7023081b56d7405c1af0bfaf72da7e24f6",50n*10n**18n));
    expect(decodeRelayBuybackInput(request,r)?.units).toBe(8);
    r.logs.push(payment(usdg,router,PRIMARY_BUYBACK_WALLET,9_000_000n));
    expect(decodeRelayBuybackInput(request,r)).toBeNull();
  });
  it("completes the total only when every missing cost has a matching historical quote",()=>{
    const input=decodeRelayBuybackInput(request,receipt())!;
    const data=result(), quote={address:usdg,networkId:4663,timestamp:input.timestamp,priceUsd:1.01};
    const completed=completeBuybackCosts(data,[input],{p0:[quote]});
    expect(completed.rows[0].buybacks_usd).toBe(60.1);
    expect(completed.rows[0].unpriced_buybacks).toBe(0);
    expect(completed.rows[0].transaction_audit).toBe(`4663|${hash.slice(2)}|100|0|10.1`);
    expect(completeBuybackCosts(data,[input],{p0:[{...quote,networkId:1}]})).toBe(data);
    expect(completeBuybackCosts(data,[input],{p0:[{...quote,timestamp:input.timestamp+1}]})).toBe(data);
    expect(completeBuybackCosts(data,[input],{p0:[{...quote,timestamp:input.timestamp-86401}]})).toBe(data);
    expect(completeBuybackCosts(data,[input],{})).toBe(data);
    data.rows[0].unpriced_buybacks=2;
    expect(unpricedBuybacks(data)).toEqual([]);
    expect(completeBuybackCosts(data,[input],{p0:[quote]})).toBe(data);
    data.rows[0].transaction_audit="malformed";
    expect(unpricedBuybacks(data)).toEqual([]);
  });
});
