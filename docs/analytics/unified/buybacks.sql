-- Programmable V4 buybacks: all tracked project wallets, current Robinhood token and historical Ethereum token.
-- All V4 quote currencies, matching V3 swap outputs, and verified RelayRouterV3 deliveries.
-- Historical ProtocolRevenueVaultV2 uses actual nativeSwapped, excluding treasury and keeper payments.
-- Includes purchases delivered directly to dead. No internal transfers, LP collection, or budget estimates.
-- Relayed ERC20-funded purchases require a verified input/output pair and actual payment transfer.
-- Dune native-transfer trace rules; ETH/WETH refunds reduce cost. LP fees and forwarding are excluded.
WITH token_flows AS (
 SELECT tx_hash,block_number,block_hash,
 sum(CASE WHEN topic2 IN (0x000000000000000000000000000000000000000000000000000000000000dead,0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62) THEN CAST(varbinary_to_uint256(data) AS INT256) ELSE INT256 '0' END)
 -sum(CASE WHEN topic1 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62) THEN CAST(varbinary_to_uint256(data) AS INT256) ELSE INT256 '0' END) AS v4_received_raw
 FROM robinhood.logs
 WHERE block_time>=TIMESTAMP '2026-07-28 00:00:00'
 AND contract_address=0xc60ba256b44334a0cd2c7242e98b88f031abb006
 AND topic0=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
 AND (topic1 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62)
 OR topic2 IN (0x000000000000000000000000000000000000000000000000000000000000dead,0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62))
 GROUP BY 1,2,3
), v4_pool_keys AS (
 SELECT topic1 AS pool_id,topic2=0x000000000000000000000000c60ba256b44334a0cd2c7242e98b88f031abb006 AS v4_is_token0
 FROM robinhood.logs WHERE contract_address=0x8366a39cc670b4001a1121b8f6a443a643e40951
 AND topic0=0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438
 AND (topic2=0x000000000000000000000000c60ba256b44334a0cd2c7242e98b88f031abb006 OR topic3=0x000000000000000000000000c60ba256b44334a0cd2c7242e98b88f031abb006)
), v4_buys AS (
 SELECT l.tx_hash,l.block_number,l.block_hash,sum(varbinary_to_int256(varbinary_substring(l.data,CASE WHEN k.v4_is_token0 THEN 1 ELSE 33 END,32))) AS v4_out_raw
 FROM robinhood.logs l JOIN v4_pool_keys k ON k.pool_id=l.topic1
 JOIN token_flows f ON f.tx_hash=l.tx_hash AND f.block_hash=l.block_hash AND f.v4_received_raw>INT256 '0'
 WHERE l.block_time>=TIMESTAMP '2026-07-28' AND l.contract_address=0x8366a39cc670b4001a1121b8f6a443a643e40951
 AND l.topic0=0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f GROUP BY 1,2,3
), v3_buys AS (
 -- A V4 transfer must match the emitting pool's signed Swap output exactly.
 SELECT s.tx_hash,s.block_number,s.block_hash,sum(CAST(varbinary_to_uint256(t.data) AS INT256)) AS v4_out_raw
 FROM robinhood.logs s JOIN robinhood.logs t ON t.tx_hash=s.tx_hash AND t.block_hash=s.block_hash
 AND t.contract_address=0xc60ba256b44334a0cd2c7242e98b88f031abb006
 AND t.topic0=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
 AND varbinary_substring(t.topic1,13,20)=s.contract_address
 AND CAST(varbinary_to_uint256(t.data) AS INT256) IN (-varbinary_to_int256(varbinary_substring(s.data,1,32)),-varbinary_to_int256(varbinary_substring(s.data,33,32)))
 JOIN token_flows f ON f.tx_hash=s.tx_hash AND f.block_hash=s.block_hash AND f.v4_received_raw>INT256 '0'
 WHERE s.block_time>=TIMESTAMP '2026-07-28' AND t.block_time>=TIMESTAMP '2026-07-28'
 AND s.topic0=0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67 GROUP BY 1,2,3
), pool_buys AS (
 SELECT tx_hash,block_number,block_hash,sum(v4_out_raw) AS v4_out_raw FROM (SELECT * FROM v4_buys UNION ALL SELECT * FROM v3_buys) GROUP BY 1,2,3
), relay_buys AS (
 -- Verified RelayRouterV3 FundsMovement: output delivered to a tracked wallet.
 SELECT DISTINCT tx_hash,block_hash FROM robinhood.logs
 WHERE block_time>=TIMESTAMP '2026-07-28' AND contract_address=0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f
 AND topic0=0xafbab204e8271965231d37baed9b1abca8725b7409c70314455f68bc89142b91
 AND varbinary_substring(data,13,20)=0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f
 AND varbinary_substring(data,45,20) IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62)
 AND varbinary_substring(data,77,20)=0xc60ba256b44334a0cd2c7242e98b88f031abb006
), relay_funded_inputs AS (
 -- A relayer may fund a purchase with ERC20 instead of forwarding root ETH.
 -- Require exactly one input/output FundsMovement pair from the verified approval proxy/router,
 -- a matching actual input transfer, and the independently verified V4 delivery.
 -- Refunds to the funding source or project wallets reduce the purchase cost.
 SELECT l.tx_hash,l.block_hash,l.block_time,l."index" AS log_index,
 varbinary_substring(l.data,77,20) AS asset,
 varbinary_to_int256(varbinary_substring(l.data,97,32))
   - coalesce(sum(CAST(varbinary_to_uint256(refund.data) AS INT256)),INT256 '0') AS spent_raw
 FROM robinhood.logs l
 JOIN relay_buys r ON r.tx_hash=l.tx_hash AND r.block_hash=l.block_hash
 LEFT JOIN robinhood.logs refund ON refund.tx_hash=l.tx_hash AND refund.block_hash=l.block_hash
   AND refund.block_time>=TIMESTAMP '2026-07-28'
   AND refund.contract_address=varbinary_substring(l.data,77,20)
   AND refund.topic0=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef AND varbinary_length(refund.data)=32
   AND (varbinary_substring(refund.topic2,13,20)=varbinary_substring(l.data,13,20)
     OR varbinary_substring(refund.topic2,13,20) IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62))
   AND varbinary_substring(refund.topic1,13,20) NOT IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62)
 WHERE l.block_time>=TIMESTAMP '2026-07-28' AND l.contract_address=0xccc88a9d1b4ed6b0eaba998850414b24f1c315be
   AND l.topic0=0xafbab204e8271965231d37baed9b1abca8725b7409c70314455f68bc89142b91
   AND varbinary_substring(l.data,45,20)=0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f
   AND varbinary_substring(l.data,13,20) NOT IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62)
   AND varbinary_substring(l.data,77,20) NOT IN (0x0000000000000000000000000000000000000000,0xc60ba256b44334a0cd2c7242e98b88f031abb006)
   AND EXISTS (SELECT 1 FROM robinhood.logs payment
     WHERE payment.block_time>=TIMESTAMP '2026-07-28'
       AND payment.tx_hash=l.tx_hash AND payment.block_hash=l.block_hash
       AND payment.contract_address=varbinary_substring(l.data,77,20)
       AND payment.topic0=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
       AND varbinary_substring(payment.topic1,13,20)=varbinary_substring(l.data,13,20)
       AND varbinary_substring(payment.topic2,13,20)=0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f
       AND payment.data=varbinary_substring(l.data,97,32))
   AND (SELECT count(*) FROM robinhood.logs movement
     WHERE movement.block_time>=TIMESTAMP '2026-07-28'
       AND movement.tx_hash=l.tx_hash AND movement.block_hash=l.block_hash
       AND movement.contract_address IN (0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f,0xccc88a9d1b4ed6b0eaba998850414b24f1c315be) AND movement.topic0=0xafbab204e8271965231d37baed9b1abca8725b7409c70314455f68bc89142b91)=2
 GROUP BY l.tx_hash,l.block_hash,l.block_time,l."index",l.data
), relay_funded_costs AS (
 SELECT f.tx_hash,f.block_hash,count(*) AS assets,
 count_if(p.price IS NULL OR p.price<=0 OR p.decimals IS NULL) AS unpriced_assets,
 sum(CAST(f.spent_raw AS DOUBLE)/power(10,p.decimals)*p.price) AS cost_usd
 FROM relay_funded_inputs f LEFT JOIN prices.minute p ON p.blockchain='robinhood'
   AND p.contract_address=f.asset AND p.timestamp=date_trunc('minute',f.block_time)
   AND p.timestamp>=TIMESTAMP '2026-07-28'
 WHERE f.spent_raw>INT256 '0' GROUP BY 1,2
), weth_flows AS (
 SELECT tx_hash,
 sum(CASE WHEN topic1 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62) THEN CAST(varbinary_to_uint256(data) AS INT256) ELSE INT256 '0' END)
 -sum(CASE WHEN topic2 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62) THEN CAST(varbinary_to_uint256(data) AS INT256) ELSE INT256 '0' END) AS weth_spent_wei
 FROM robinhood.logs
 WHERE block_time>=TIMESTAMP '2026-07-28 00:00:00'
 AND contract_address=0x0bd7d308f8e1639fab988df18a8011f41eacad73
 AND topic0=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
 AND (topic1 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62)
 OR topic2 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62))
 GROUP BY 1
), native_flows AS (
 SELECT tx_hash,count_if(cardinality(trace_address)=0) AS root_count,
 sum(CASE WHEN "from" IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62) THEN CAST(value AS INT256) ELSE INT256 '0' END)
 -sum(CASE WHEN "to" IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62)
 OR (type='suicide' AND refund_address IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62)) THEN CAST(value AS INT256) ELSE INT256 '0' END) AS native_spent_wei
 FROM robinhood.traces
 WHERE block_time>=TIMESTAMP '2026-07-28 00:00:00' AND success AND tx_success AND value>0
 AND (call_type='call' OR type='suicide')
 AND ("from" IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62)
 OR "to" IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62)
 OR refund_address IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62))
 GROUP BY 1
), other_token_flows AS (
 SELECT tx_hash,contract_address AS asset,min(block_time) AS block_time,
 sum(CASE WHEN topic1 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62) THEN CAST(varbinary_to_uint256(data) AS INT256) ELSE INT256 '0' END)
 -sum(CASE WHEN topic2 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62) THEN CAST(varbinary_to_uint256(data) AS INT256) ELSE INT256 '0' END) AS spent_raw
 FROM robinhood.logs WHERE block_time>=TIMESTAMP '2026-07-28' AND topic0=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef AND varbinary_length(data)=32
 AND contract_address NOT IN (0xc60ba256b44334a0cd2c7242e98b88f031abb006,0x0bd7d308f8e1639fab988df18a8011f41eacad73)
 AND (topic1 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62) OR topic2 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62))
 GROUP BY 1,2 HAVING sum(CASE WHEN topic1 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62) THEN CAST(varbinary_to_uint256(data) AS INT256) ELSE INT256 '0' END)-sum(CASE WHEN topic2 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62) THEN CAST(varbinary_to_uint256(data) AS INT256) ELSE INT256 '0' END)>INT256 '0'
), other_costs AS (
 SELECT f.tx_hash,count(*) AS assets,count_if(p.price IS NULL OR p.decimals IS NULL) AS unpriced_assets,
 sum(CAST(f.spent_raw AS DOUBLE)/power(10,p.decimals)*p.price) AS cost_usd
 FROM other_token_flows f LEFT JOIN prices.minute p ON p.blockchain='robinhood' AND p.contract_address=f.asset AND p.timestamp=date_trunc('minute',f.block_time) AND p.timestamp>=TIMESTAMP '2026-07-28'
 GROUP BY 1
), rh_purchases AS (
 SELECT 4663 AS chain_id,t.hash AS tx_hash,t.block_number,t.block_time AS purchase_time,least(v.v4_received_raw,p.v4_out_raw) AS v4_raw,
 CASE WHEN t."from" NOT IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62) AND r.tx_hash IS NOT NULL AND t.value>0 THEN CAST(t.value AS INT256)+coalesce(n.native_spent_wei,INT256 '0')+coalesce(w.weth_spent_wei,INT256 '0') WHEN ((t.value>0 AND n.root_count=1) OR t.value=0) THEN coalesce(n.native_spent_wei,INT256 '0')+coalesce(w.weth_spent_wei,INT256 '0') ELSE CAST(NULL AS INT256) END AS spent_wei,
 CASE WHEN coalesce(usd.price, eth_native.price, usd_hour.price)>0 THEN coalesce(usd.price, eth_native.price, usd_hour.price) ELSE CAST(NULL AS DOUBLE) END AS eth_usd,
 CASE WHEN usd.price>0 THEN 'external_weth_minute' WHEN eth_native.price>0 THEN 'external_eth_minute' ELSE 'external_weth_hour' END AS price_source, coalesce(o.assets,0)+IF(t.value=0 AND coalesce(n.native_spent_wei,INT256 '0')=INT256 '0' AND coalesce(w.weth_spent_wei,INT256 '0')=INT256 '0' AND coalesce(o.assets,0)=0,coalesce(rf.assets,0),0) AS other_assets,coalesce(o.unpriced_assets,0)+IF(t.value=0 AND coalesce(n.native_spent_wei,INT256 '0')=INT256 '0' AND coalesce(w.weth_spent_wei,INT256 '0')=INT256 '0' AND coalesce(o.assets,0)=0,coalesce(rf.unpriced_assets,0),0) AS unpriced_assets,coalesce(o.cost_usd,0)+IF(t.value=0 AND coalesce(n.native_spent_wei,INT256 '0')=INT256 '0' AND coalesce(w.weth_spent_wei,INT256 '0')=INT256 '0' AND coalesce(o.assets,0)=0,coalesce(rf.cost_usd,0),0) AS other_cost_usd
 FROM robinhood.transactions t
 JOIN token_flows v ON v.tx_hash=t.hash AND v.block_hash=t.block_hash
 JOIN pool_buys p ON p.tx_hash=t.hash AND p.block_hash=t.block_hash
 LEFT JOIN relay_buys r ON r.tx_hash=t.hash AND r.block_hash=t.block_hash
 LEFT JOIN relay_funded_costs rf ON rf.tx_hash=t.hash AND rf.block_hash=t.block_hash
 LEFT JOIN other_costs o ON o.tx_hash=t.hash
 LEFT JOIN native_flows n ON n.tx_hash=t.hash
 LEFT JOIN weth_flows w ON w.tx_hash=t.hash
 LEFT JOIN prices_external.minute usd ON usd.blockchain='ethereum' AND usd.contract_address=0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2
 AND usd.timestamp>=TIMESTAMP '2026-07-28 00:00:00' AND usd.timestamp=date_trunc('minute',t.block_time)
 LEFT JOIN prices_external.minute eth_native ON eth_native.blockchain='ethereum' AND eth_native.contract_address=0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
 AND eth_native.timestamp>=TIMESTAMP '2026-07-28 00:00:00' AND eth_native.timestamp=date_trunc('minute',t.block_time)
 LEFT JOIN prices_external.hour usd_hour ON usd_hour.blockchain='ethereum' AND usd_hour.contract_address=0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2
 AND usd_hour.timestamp>=TIMESTAMP '2026-07-28 00:00:00' AND usd_hour.timestamp=date_trunc('hour',t.block_time)
 WHERE t.block_time>=TIMESTAMP '2026-07-28 00:00:00' AND t.success
 AND (t."from" IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62) OR (r.tx_hash IS NOT NULL AND (
   (t."to"=0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f AND t.value>0)
   OR coalesce(o.assets,0)>0
   OR coalesce(n.native_spent_wei,INT256 '0')+coalesce(w.weth_spent_wei,INT256 '0')>INT256 '0'
   OR (t.value=0 AND coalesce(n.native_spent_wei,INT256 '0')=INT256 '0' AND coalesce(w.weth_spent_wei,INT256 '0')=INT256 '0' AND coalesce(o.assets,0)=0 AND coalesce(rf.assets,0)>0))))
 AND v.v4_received_raw>INT256 '0' AND p.v4_out_raw>INT256 '0'
), eth_purchases AS (
-- Programmable V4 buybacks on Robinhood Chain.
-- V4 purchases across ETH/WETH pools, funded by any observed wallet asset.
-- Includes purchases delivered directly to dead. No internal transfers, LP collection, or budget estimates.
-- Dune native-transfer trace rules; ETH/WETH refunds reduce cost. LP fees and forwarding are excluded.
WITH token_flows AS (
 SELECT tx_hash,block_number,block_hash,
 sum(CASE WHEN topic2 IN (0x000000000000000000000000000000000000000000000000000000000000dead,0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62) THEN CAST(varbinary_to_uint256(data) AS INT256) ELSE INT256 '0' END)
 -sum(CASE WHEN topic1 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62) THEN CAST(varbinary_to_uint256(data) AS INT256) ELSE INT256 '0' END) AS v4_received_raw
 FROM ethereum.logs
 WHERE block_time>=TIMESTAMP '2026-07-28 00:00:00'
 AND contract_address=0x7987f03462200b3d8a072e02c89a8a41dcb124ee
 AND topic0=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
 AND (topic1 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62)
 OR topic2 IN (0x000000000000000000000000000000000000000000000000000000000000dead,0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62))
 GROUP BY 1,2,3
), v4_pool_keys AS (
 SELECT topic1 AS pool_id,topic2=0x0000000000000000000000007987f03462200b3d8a072e02c89a8a41dcb124ee AS v4_is_token0
 FROM ethereum.logs WHERE contract_address=0x000000000004444c5dc75cb358380d2e3de08a90
 AND topic0=0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438
 AND (topic2=0x0000000000000000000000007987f03462200b3d8a072e02c89a8a41dcb124ee OR topic3=0x0000000000000000000000007987f03462200b3d8a072e02c89a8a41dcb124ee)
), v4_buys AS (
 SELECT l.tx_hash,l.block_number,l.block_hash,sum(varbinary_to_int256(varbinary_substring(l.data,CASE WHEN k.v4_is_token0 THEN 1 ELSE 33 END,32))) AS v4_out_raw
 FROM ethereum.logs l JOIN v4_pool_keys k ON k.pool_id=l.topic1
 JOIN token_flows f ON f.tx_hash=l.tx_hash AND f.block_hash=l.block_hash AND f.v4_received_raw>INT256 '0'
 WHERE l.block_time>=TIMESTAMP '2026-07-28' AND l.contract_address=0x000000000004444c5dc75cb358380d2e3de08a90
 AND l.topic0=0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f GROUP BY 1,2,3
), v3_buys AS (
 -- A V4 transfer must match the emitting pool's signed Swap output exactly.
 SELECT s.tx_hash,s.block_number,s.block_hash,sum(CAST(varbinary_to_uint256(t.data) AS INT256)) AS v4_out_raw
 FROM ethereum.logs s JOIN ethereum.logs t ON t.tx_hash=s.tx_hash AND t.block_hash=s.block_hash
 AND t.contract_address=0x7987f03462200b3d8a072e02c89a8a41dcb124ee
 AND t.topic0=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
 AND varbinary_substring(t.topic1,13,20)=s.contract_address
 AND CAST(varbinary_to_uint256(t.data) AS INT256) IN (-varbinary_to_int256(varbinary_substring(s.data,1,32)),-varbinary_to_int256(varbinary_substring(s.data,33,32)))
 JOIN token_flows f ON f.tx_hash=s.tx_hash AND f.block_hash=s.block_hash AND f.v4_received_raw>INT256 '0'
 WHERE s.block_time>=TIMESTAMP '2026-07-28' AND t.block_time>=TIMESTAMP '2026-07-28'
 AND s.topic0=0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67 GROUP BY 1,2,3
), pool_buys AS (
 SELECT tx_hash,block_number,block_hash,sum(v4_out_raw) AS v4_out_raw FROM (SELECT * FROM v4_buys UNION ALL SELECT * FROM v3_buys) GROUP BY 1,2,3
), relay_buys AS (
 -- Verified RelayRouterV3 FundsMovement: output delivered to a tracked wallet.
 SELECT DISTINCT tx_hash,block_hash FROM ethereum.logs
 WHERE block_time>=TIMESTAMP '2026-07-28' AND contract_address=0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f
 AND topic0=0xafbab204e8271965231d37baed9b1abca8725b7409c70314455f68bc89142b91
 AND varbinary_substring(data,13,20)=0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f
 AND varbinary_substring(data,45,20) IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62)
 AND varbinary_substring(data,77,20)=0x7987f03462200b3d8a072e02c89a8a41dcb124ee
), weth_flows AS (
 SELECT tx_hash,
 sum(CASE WHEN topic1 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62) THEN CAST(varbinary_to_uint256(data) AS INT256) ELSE INT256 '0' END)
 -sum(CASE WHEN topic2 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62) THEN CAST(varbinary_to_uint256(data) AS INT256) ELSE INT256 '0' END) AS weth_spent_wei
 FROM ethereum.logs
 WHERE block_time>=TIMESTAMP '2026-07-28 00:00:00'
 AND contract_address=0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2
 AND topic0=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
 AND (topic1 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62)
 OR topic2 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62))
 GROUP BY 1
), native_flows AS (
 SELECT tx_hash,count_if(cardinality(trace_address)=0) AS root_count,
 sum(CASE WHEN "from" IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62) THEN CAST(value AS INT256) ELSE INT256 '0' END)
 -sum(CASE WHEN "to" IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62)
 OR (type='suicide' AND refund_address IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62)) THEN CAST(value AS INT256) ELSE INT256 '0' END) AS native_spent_wei
 FROM ethereum.traces
 WHERE block_time>=TIMESTAMP '2026-07-28 00:00:00' AND success AND tx_success AND value>0
 AND (call_type='call' OR type='suicide')
 AND ("from" IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62)
 OR "to" IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62)
 OR refund_address IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62))
 GROUP BY 1
), other_token_flows AS (
 SELECT tx_hash,contract_address AS asset,min(block_time) AS block_time,
 sum(CASE WHEN topic1 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62) THEN CAST(varbinary_to_uint256(data) AS INT256) ELSE INT256 '0' END)
 -sum(CASE WHEN topic2 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62) THEN CAST(varbinary_to_uint256(data) AS INT256) ELSE INT256 '0' END) AS spent_raw
 FROM ethereum.logs WHERE block_time>=TIMESTAMP '2026-07-28' AND topic0=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef AND varbinary_length(data)=32
 AND contract_address NOT IN (0x7987f03462200b3d8a072e02c89a8a41dcb124ee,0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2)
 AND (topic1 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62) OR topic2 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62))
 GROUP BY 1,2 HAVING sum(CASE WHEN topic1 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62) THEN CAST(varbinary_to_uint256(data) AS INT256) ELSE INT256 '0' END)-sum(CASE WHEN topic2 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62) THEN CAST(varbinary_to_uint256(data) AS INT256) ELSE INT256 '0' END)>INT256 '0'
), other_costs AS (
 SELECT f.tx_hash,count(*) AS assets,count_if(p.price IS NULL OR p.decimals IS NULL) AS unpriced_assets,
 sum(CAST(f.spent_raw AS DOUBLE)/power(10,p.decimals)*p.price) AS cost_usd
 FROM other_token_flows f LEFT JOIN prices.minute p ON p.blockchain='ethereum' AND p.contract_address=f.asset AND p.timestamp=date_trunc('minute',f.block_time) AND p.timestamp>=TIMESTAMP '2026-07-28'
 GROUP BY 1
), legacy_buybacks AS (
 SELECT tx_hash,block_hash,varbinary_to_int256(varbinary_substring(data,97,32)) AS native_spent_wei,varbinary_to_int256(varbinary_substring(data,129,32)) AS tokens_bought
 FROM ethereum.logs WHERE block_time>=TIMESTAMP '2026-07-28'
 AND contract_address=0xb603994cf90ed0ce057d9d50a22257bbc89a4dea
 AND topic0=0xf3bc1eb3f836790d35125676ab329b9c1a63b5419e693f1418a0749717035c0d
 AND topic2 IN (0x000000000000000000000000d88539d3c4c460136a733a3fd60cf6bf269079da,0x00000000000000000000000039544a7023081b56d7405c1af0bfaf72da7e24f6,0x0000000000000000000000004957f49620aff3adbbe8195a4f633e49cc93376c,0x0000000000000000000000009f5856a3578faba96a6e8dfd9c10563a1e598f62)
), purchases AS (
 SELECT 1 AS chain_id,t.hash AS tx_hash,t.block_number,t.block_time AS purchase_time,least(v.v4_received_raw,p.v4_out_raw) AS v4_raw,
 CASE WHEN lb.tx_hash IS NOT NULL THEN lb.native_spent_wei WHEN t."from" NOT IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62) AND r.tx_hash IS NOT NULL AND t.value>0 THEN CAST(t.value AS INT256)+coalesce(n.native_spent_wei,INT256 '0')+coalesce(w.weth_spent_wei,INT256 '0') WHEN ((t.value>0 AND n.root_count=1) OR t.value=0) THEN coalesce(n.native_spent_wei,INT256 '0')+coalesce(w.weth_spent_wei,INT256 '0') ELSE CAST(NULL AS INT256) END AS spent_wei,
 CASE WHEN coalesce(usd.price, eth_native.price, usd_hour.price)>0 THEN coalesce(usd.price, eth_native.price, usd_hour.price) ELSE CAST(NULL AS DOUBLE) END AS eth_usd,
 CASE WHEN usd.price>0 THEN 'external_weth_minute' WHEN eth_native.price>0 THEN 'external_eth_minute' ELSE 'external_weth_hour' END AS price_source, coalesce(o.assets,0) AS other_assets,coalesce(o.unpriced_assets,0) AS unpriced_assets,coalesce(o.cost_usd,0) AS other_cost_usd
 FROM ethereum.transactions t
 JOIN token_flows v ON v.tx_hash=t.hash AND v.block_hash=t.block_hash
 JOIN pool_buys p ON p.tx_hash=t.hash AND p.block_hash=t.block_hash
 LEFT JOIN legacy_buybacks lb ON lb.tx_hash=t.hash AND lb.block_hash=t.block_hash
 LEFT JOIN relay_buys r ON r.tx_hash=t.hash AND r.block_hash=t.block_hash
 LEFT JOIN other_costs o ON o.tx_hash=t.hash
 LEFT JOIN native_flows n ON n.tx_hash=t.hash
 LEFT JOIN weth_flows w ON w.tx_hash=t.hash
 LEFT JOIN prices_external.minute usd ON usd.blockchain='ethereum' AND usd.contract_address=0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2
 AND usd.timestamp>=TIMESTAMP '2026-07-28 00:00:00' AND usd.timestamp=date_trunc('minute',t.block_time)
 LEFT JOIN prices_external.minute eth_native ON eth_native.blockchain='ethereum' AND eth_native.contract_address=0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
 AND eth_native.timestamp>=TIMESTAMP '2026-07-28 00:00:00' AND eth_native.timestamp=date_trunc('minute',t.block_time)
 LEFT JOIN prices_external.hour usd_hour ON usd_hour.blockchain='ethereum' AND usd_hour.contract_address=0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2
 AND usd_hour.timestamp>=TIMESTAMP '2026-07-28 00:00:00' AND usd_hour.timestamp=date_trunc('hour',t.block_time)
 WHERE t.block_time>=TIMESTAMP '2026-07-28 00:00:00' AND t.success
 AND (lb.tx_hash IS NOT NULL OR t."from" IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62) OR (r.tx_hash IS NOT NULL AND t."to"=0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f AND t.value>0))
 AND v.v4_received_raw>INT256 '0' AND p.v4_out_raw>INT256 '0'
) SELECT * FROM purchases
), purchases AS (SELECT * FROM rh_purchases UNION ALL SELECT * FROM eth_purchases), indexed_tips AS (
 SELECT 4663 AS chain_id,least(
 (SELECT max(block_number) FROM robinhood.logs WHERE block_time>=current_timestamp-INTERVAL '1' HOUR),
 (SELECT max(block_number) FROM robinhood.transactions WHERE block_time>=current_timestamp-INTERVAL '1' HOUR),
 (SELECT max(block_number) FROM robinhood.traces WHERE block_time>=current_timestamp-INTERVAL '1' HOUR)) AS indexed_block
 UNION ALL SELECT 1,least((SELECT max(block_number) FROM ethereum.logs WHERE block_time>=current_timestamp-INTERVAL '1' HOUR),(SELECT max(block_number) FROM ethereum.transactions WHERE block_time>=current_timestamp-INTERVAL '1' HOUR),(SELECT max(block_number) FROM ethereum.traces WHERE block_time>=current_timestamp-INTERVAL '1' HOUR))
), finalized_rpc AS (
 SELECT 4663 AS chain_id,reply FROM UNNEST(ARRAY[json_parse(http_post('https://rpc.mainnet.chain.robinhood.com','{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["finalized",false]}',ARRAY['Content-Type: application/json']))]) r(reply)
 UNION ALL SELECT 1,reply FROM UNNEST(ARRAY[json_parse(http_post('https://ethereum-rpc.publicnode.com','{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["finalized",false]}',ARRAY['Content-Type: application/json']))]) r(reply)
), checkpoint AS (
 SELECT i.chain_id,least(coalesce(i.indexed_block,from_base(concat('DUNE_INDEXED_TIP_MISSING_',json_format(r.reply)),16)),from_base(coalesce(substr(json_extract_scalar(r.reply,'$.result.number'),3),'RPC_FINALITY_MISSING'),16)) AS through_block
 FROM indexed_tips i JOIN finalized_rpc r ON r.chain_id=i.chain_id
)
SELECT count(p.tx_hash) AS buyback_transactions,
 CAST(coalesce(sum(CASE WHEN p.chain_id=4663 THEN p.v4_raw ELSE INT256 '0' END),INT256 '0') AS DOUBLE)/1e18 AS v4_bought_back,
 CAST(coalesce(sum(CASE WHEN p.chain_id=4663 THEN p.v4_raw ELSE INT256 '0' END),INT256 '0') AS DOUBLE)/1e18/1e9*100 AS supply_bought_back_pct,
 CAST(coalesce(sum(p.spent_wei),INT256 '0') AS DOUBLE)/1e18 AS eth_spent,
 CASE WHEN count_if(p.spent_wei IS NULL OR p.unpriced_assets>0 OR (p.spent_wei<>INT256 '0' AND p.eth_usd IS NULL) OR (p.spent_wei<=INT256 '0' AND p.other_assets=0))=0 THEN coalesce(sum(CAST(p.spent_wei AS DOUBLE)/1e18*coalesce(p.eth_usd,0)+p.other_cost_usd),0) END AS buybacks_usd,
 coalesce(sum(CAST(p.spent_wei AS DOUBLE)/1e18*coalesce(p.eth_usd,0)+p.other_cost_usd),0) AS buybacks_priced_subtotal_usd,
 count_if(p.spent_wei IS NULL OR p.unpriced_assets>0 OR (p.spent_wei<>INT256 '0' AND p.eth_usd IS NULL) OR (p.spent_wei<=INT256 '0' AND p.other_assets=0)) AS unpriced_buybacks,
 CAST(coalesce(sum(CASE WHEN p.chain_id=1 THEN p.v4_raw ELSE INT256 '0' END),INT256 '0') AS DOUBLE)/1e18 AS legacy_eth_v4_bought_back,
 array_join(array_agg(CAST(p.chain_id AS VARCHAR)||'|'||to_hex(p.tx_hash)||'|'||CAST(CAST(p.v4_raw AS DOUBLE)/1e18 AS VARCHAR)||'|'||CAST(CAST(p.spent_wei AS DOUBLE)/1e18 AS VARCHAR)||'|'||CAST(p.other_cost_usd AS VARCHAR)), ';') AS transaction_audit,
 array_join(array_agg(CAST(p.chain_id AS VARCHAR)||'|'||to_hex(p.tx_hash)||'|'||CAST(CAST(p.v4_raw AS DOUBLE)/1e18 AS VARCHAR)||'|'||CAST(p.purchase_time AS VARCHAR)||'|'||CAST(p.block_number AS VARCHAR) ORDER BY p.purchase_time DESC) FILTER (WHERE p.tx_hash IS NOT NULL), ';') AS buyback_events_v1,
 max(p.purchase_time) AS latest_buyback_utc,max(c.through_block) AS through_block,
 count_if(p.price_source='external_weth_hour') AS hourly_priced_purchases
FROM checkpoint c LEFT JOIN purchases p ON p.chain_id=c.chain_id AND p.block_number<=c.through_block
