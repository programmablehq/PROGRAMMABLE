-- Collected fee events for the three disclosed Programmable wallets.
-- Claims are counted when finalized; accrued but unclaimed fees are excluded.
-- Canonical launch components and factory ledgers are discovered from stamped onchain sources.
-- This is source-attributed revenue, not all transfers into a treasury wallet.
-- Nonstandard fee interfaces require explicit adapters; unidentified receipts are not revenue.
-- Missing asset prices remain unknown; V4 received as own LP fees is not purchased V4.
-- PositionFeesForwarder takes fees directly from PoolManager to feeRecipient; the locker is not the transfer sender.
WITH fixed_sources(chain_id,address,kind,asset) AS (VALUES (1,0xadf955a44fd7f009380240d56d71dfafb46020cc,'classic_native',0x0000000000000000000000000000000000000000),
(1,0x35fe236ea82f7cf525c9719d7df8f49f94d720cc,'classic_native',0x0000000000000000000000000000000000000000),
(1,0x025a386eaa79f6067d29848fd05ccc71beab20cc,'classic_native',0x0000000000000000000000000000000000000000),
(1,0x48bb2672c7fd2a12e7fb5d46c441ccd3726520cc,'classic_native',0x0000000000000000000000000000000000000000),
(1,0x90c67c1e866f86526f0e338459cd435e1f23a0cc,'classic_quote',0x0000000000000000000000000000000000000000),
(1,0x7773d183fe7b60d4f1885047fa42b815a62fe0cc,'classic_quote',0x0000000000000000000000000000000000000000),
(1,0xf1749e78e76cfe1119206833ae93bed2dede5353,'legacy_vault',0x0000000000000000000000000000000000000000),
(1,0xc3fddcef8d96ed0f648245a96c44162fb77bf014,'legacy_vault',0x0000000000000000000000000000000000000000),
(4663,0x8e40080836af89952071d241684c7a848a485ac4,'native_ledger',0x0000000000000000000000000000000000000000),
(4663,0x029ac9c1f6f3dc8d7736bd254c156b43edad15ac,'quote_ledger',0x0000000000000000000000000000000000000000)),
 factories(chain_id,address,topic) AS (VALUES (4663,0x32897c76e4e87d72f404f33f01e4ef2a76931286,0xb49f0564306d89078cb0b3ba713483e150fb77b5a00026fd9be477c471383d34),
(4663,0xc02a2bebecb60c8d2e9e0176a4438845eae66a5c,0x6170d19d4db2409523b652a3bf190bc7629b0a1af2e5118536ecd4b62364b099),
(4663,0x31bce40a6d28db69bf0b6cd0abc5d8f506626acc,0x6170d19d4db2409523b652a3bf190bc7629b0a1af2e5118536ecd4b62364b099),
(4663,0x18cab14c69d0fe6df4a96256318b51c51c98da3f,0x6170d19d4db2409523b652a3bf190bc7629b0a1af2e5118536ecd4b62364b099),
(4663,0xa3479cb16fdb71b706b8961dc50be6404c05c7ea,0xc3c5d5e4abbd15966e584a111dd56b7568327d03138a9bb801993be4c37618c1)),
 routers(chain_id,address) AS (VALUES (1,0x8622dd5bab44185f2a458ac90384ac99248f8d56),
(1,0xbe4bf6ac8c6f012e1c8f25747a9fbccb2fdac4c3),
(4663,0x34965f2a2ee9254522232c32f02056e92be0c98a),
(4663,0x9fd629cd1eb47fb20813c2403153714b523f681e),
(4663,0x4b5cec6e715c3bcd7e6837e9e307c40c9acc2b2e)),
 plan_sources(chain_id,address,component_topic,stamp_topic) AS (VALUES (4663,0xe21827818fea1f14d59929cae36a93c0b44e0ae1,0x1dfc3e9bdf26ebc4d1d63607a4201889c3ee884f57830f78c271eb25cc1027bc,0x15ceb1b49fa6ac04c745019a219162db39b20faa1ca2ffe9bbd5f588ee833f36),
(4663,0xb2a5eba2554aae969bc513a59c1d676e3400e11e,0xb212a385de739a6a3bd51dadd2e23dddbf51b36083effd98c0648d2f081097f3,0x6b7bc0903feed213f29c6f4f1707d5961d2609db0666a511204ec69b1e0931e8),
(4663,0x3d3470550c2d14c61e4611c5a010c5d7c53f16fe,0xb212a385de739a6a3bd51dadd2e23dddbf51b36083effd98c0648d2f081097f3,0x6b7bc0903feed213f29c6f4f1707d5961d2609db0666a511204ec69b1e0931e8),
(4663,0x0ad35ef4aa70d4c31a2a44fb3cc8ebfcb253275e,0x1dfc3e9bdf26ebc4d1d63607a4201889c3ee884f57830f78c271eb25cc1027bc,0x15ceb1b49fa6ac04c745019a219162db39b20faa1ca2ffe9bbd5f588ee833f36)),
 index_heads AS (
 SELECT 1 AS chain_id,max(number)-64 AS through_block FROM ethereum.blocks WHERE time>current_timestamp-INTERVAL '1' DAY
 UNION ALL SELECT 4663,max(block_number) FROM robinhood.logs WHERE block_time>current_timestamp-INTERVAL '1' DAY
 ), logs AS (
 SELECT 1 AS chain_id,block_number,block_time,tx_hash,"index" AS log_index,contract_address,topic0,topic1,topic2,topic3,data
 FROM ethereum.logs WHERE block_time>=TIMESTAMP '2026-07-01' AND block_number<=(SELECT through_block FROM index_heads WHERE chain_id=1) AND (topic0 IN (0x15ceb1b49fa6ac04c745019a219162db39b20faa1ca2ffe9bbd5f588ee833f36,0x0e03635ec70be68229afa80a4b17402fce91d60e7fd3499d709c4271ba408840,0x1dfc3e9bdf26ebc4d1d63607a4201889c3ee884f57830f78c271eb25cc1027bc,0x2af0af776b649e399eb457aaa4f4c153142426f58830e2ea2d2d5f102bf7dce2,0x34579ce58c22de68fe7e545753ced212a5b682a2e81614171dbf2039de2454d8,0x3ac225b7f0fd8037879124e884f609edaed1dd2eab0649f13b5b70ed4f63ac86,0x477c82c33085e0da9febf1f975aae54f3dec43d0466a7bddf38484cd90a32957,0x6170d19d4db2409523b652a3bf190bc7629b0a1af2e5118536ecd4b62364b099,0x775f4e4bf8b8867e60274a57c3cd35202f03a466c26fd144cc6585b2482168b4,0x7d41ef2ca0417b1f34e24f6baa6bb801e64d7c82436e45963c2f78a168ba8251,0x8147265e7396d6400cee8d049456a1f7438fdfbe2a7c81c976d51ba67e52ff4b,0x8e163acc5593cf3fce7106bbacfdb65bd17890d6262590c80bebd3382197a920,0xb212a385de739a6a3bd51dadd2e23dddbf51b36083effd98c0648d2f081097f3,0xb49f0564306d89078cb0b3ba713483e150fb77b5a00026fd9be477c471383d34,0xc3c5d5e4abbd15966e584a111dd56b7568327d03138a9bb801993be4c37618c1,0xde7382b4a0346dc5680e562522cef9e22d7597329cfcbe4852da453d00a2fbc9,0xefe2b52a15eefb739f710899cacc48ca85cb7e1935ec83fbb4176e8f9bc5df8a) OR (topic0=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef AND topic1 IN (0x0000000000000000000000009f9424bbcce8a865f70155fe40fb22a103ebec63,0x0000000000000000000000008366a39cc670b4001a1121b8f6a443a643e40951)))
 UNION ALL SELECT 4663,block_number,block_time,tx_hash,"index",contract_address,topic0,topic1,topic2,topic3,data
 FROM robinhood.logs WHERE block_time>=TIMESTAMP '2026-08-01' AND block_number<=(SELECT through_block FROM index_heads WHERE chain_id=4663) AND (topic0 IN (0x15ceb1b49fa6ac04c745019a219162db39b20faa1ca2ffe9bbd5f588ee833f36,0x0e03635ec70be68229afa80a4b17402fce91d60e7fd3499d709c4271ba408840,0x1dfc3e9bdf26ebc4d1d63607a4201889c3ee884f57830f78c271eb25cc1027bc,0x2af0af776b649e399eb457aaa4f4c153142426f58830e2ea2d2d5f102bf7dce2,0x34579ce58c22de68fe7e545753ced212a5b682a2e81614171dbf2039de2454d8,0x3ac225b7f0fd8037879124e884f609edaed1dd2eab0649f13b5b70ed4f63ac86,0x477c82c33085e0da9febf1f975aae54f3dec43d0466a7bddf38484cd90a32957,0x6170d19d4db2409523b652a3bf190bc7629b0a1af2e5118536ecd4b62364b099,0x775f4e4bf8b8867e60274a57c3cd35202f03a466c26fd144cc6585b2482168b4,0x7d41ef2ca0417b1f34e24f6baa6bb801e64d7c82436e45963c2f78a168ba8251,0x8147265e7396d6400cee8d049456a1f7438fdfbe2a7c81c976d51ba67e52ff4b,0x8e163acc5593cf3fce7106bbacfdb65bd17890d6262590c80bebd3382197a920,0xb212a385de739a6a3bd51dadd2e23dddbf51b36083effd98c0648d2f081097f3,0xb49f0564306d89078cb0b3ba713483e150fb77b5a00026fd9be477c471383d34,0xc3c5d5e4abbd15966e584a111dd56b7568327d03138a9bb801993be4c37618c1,0xde7382b4a0346dc5680e562522cef9e22d7597329cfcbe4852da453d00a2fbc9,0xefe2b52a15eefb739f710899cacc48ca85cb7e1935ec83fbb4176e8f9bc5df8a) OR (topic0=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef AND topic1 IN (0x0000000000000000000000009f9424bbcce8a865f70155fe40fb22a103ebec63,0x0000000000000000000000008366a39cc670b4001a1121b8f6a443a643e40951)))
 ), components AS (
 SELECT DISTINCT l.chain_id,varbinary_substring(l.topic2,13,20) AS address,l.block_number AS proof_block
 FROM logs l JOIN routers r ON r.chain_id=l.chain_id AND r.address=l.contract_address
 WHERE l.topic0=0x8147265e7396d6400cee8d049456a1f7438fdfbe2a7c81c976d51ba67e52ff4b
 UNION SELECT DISTINCT l.chain_id,varbinary_substring(l.topic3,13,20),greatest(l.block_number,stamp.block_number)
 FROM logs l JOIN plan_sources p ON p.chain_id=l.chain_id AND p.address=l.contract_address AND p.component_topic=l.topic0
 JOIN logs stamp ON stamp.chain_id=l.chain_id AND stamp.contract_address=l.contract_address AND stamp.tx_hash=l.tx_hash AND stamp.topic1=l.topic1 AND stamp.topic0=p.stamp_topic
 WHERE varbinary_substring(stamp.topic2,13,20)<>0x0dbe4f551b318fbba7e7a1975c3a62b9392b8595
 ), foundation_sources AS (
 SELECT DISTINCT l.chain_id,varbinary_substring(l.data,45,20) AS address,'foundation' AS kind,varbinary_substring(l.data,77,20) AS asset,l.block_number AS proof_block
 FROM logs l JOIN factories f ON f.chain_id=l.chain_id AND f.address=l.contract_address AND f.topic=l.topic0
 UNION SELECT DISTINCT l.chain_id,varbinary_substring(l.data,45,20),'foundation',varbinary_substring(l.data,77,20),greatest(l.block_number,c.proof_block)
 FROM logs l JOIN components c ON c.chain_id=l.chain_id AND c.address=l.contract_address
 WHERE l.chain_id=1 AND l.topic0 IN (0x6170d19d4db2409523b652a3bf190bc7629b0a1af2e5118536ecd4b62364b099,0xc3c5d5e4abbd15966e584a111dd56b7568327d03138a9bb801993be4c37618c1)
 ), sources AS (
 SELECT *,BIGINT '0' AS proof_block FROM fixed_sources UNION SELECT * FROM foundation_sources
 UNION SELECT chain_id,address,'custom_component',0x0000000000000000000000000000000000000000,proof_block FROM components
 ), raw_claims AS (
 SELECT l.chain_id,l.block_number,l.block_time,l.tx_hash,l.log_index,l.contract_address AS source,
 CASE WHEN l.topic0=0x3ac225b7f0fd8037879124e884f609edaed1dd2eab0649f13b5b70ed4f63ac86 THEN varbinary_substring(l.topic3,13,20) WHEN l.topic0 IN (0x775f4e4bf8b8867e60274a57c3cd35202f03a466c26fd144cc6585b2482168b4,0x8e163acc5593cf3fce7106bbacfdb65bd17890d6262590c80bebd3382197a920,0x34579ce58c22de68fe7e545753ced212a5b682a2e81614171dbf2039de2454d8,0x3ac225b7f0fd8037879124e884f609edaed1dd2eab0649f13b5b70ed4f63ac86,0x2af0af776b649e399eb457aaa4f4c153142426f58830e2ea2d2d5f102bf7dce2,0x477c82c33085e0da9febf1f975aae54f3dec43d0466a7bddf38484cd90a32957) THEN varbinary_substring(l.topic2,13,20) ELSE varbinary_substring(l.topic1,13,20) END AS recipient,
 CASE WHEN l.topic0=0x7d41ef2ca0417b1f34e24f6baa6bb801e64d7c82436e45963c2f78a168ba8251 THEN s.asset WHEN l.topic0=0x8e163acc5593cf3fce7106bbacfdb65bd17890d6262590c80bebd3382197a920 THEN varbinary_substring(l.topic3,13,20) WHEN l.topic0 IN (0x3ac225b7f0fd8037879124e884f609edaed1dd2eab0649f13b5b70ed4f63ac86,0x477c82c33085e0da9febf1f975aae54f3dec43d0466a7bddf38484cd90a32957) THEN varbinary_substring(l.topic1,13,20) ELSE 0x0000000000000000000000000000000000000000 END AS asset,
 varbinary_to_uint256(varbinary_substring(l.data,CASE WHEN l.topic0 IN (0x8e163acc5593cf3fce7106bbacfdb65bd17890d6262590c80bebd3382197a920,0xde7382b4a0346dc5680e562522cef9e22d7597329cfcbe4852da453d00a2fbc9) THEN 33 ELSE 1 END,32)) AS amount_raw,
 s.kind,greatest(l.block_number,s.proof_block) AS proof_block
 FROM logs l JOIN sources s ON s.chain_id=l.chain_id AND s.address=l.contract_address
 WHERE (s.kind='foundation' AND l.topic0=0x7d41ef2ca0417b1f34e24f6baa6bb801e64d7c82436e45963c2f78a168ba8251 AND varbinary_to_uint256(l.topic2)=UINT256 '0')
 OR (s.kind='classic_native' AND l.topic0=0x775f4e4bf8b8867e60274a57c3cd35202f03a466c26fd144cc6585b2482168b4) OR (s.kind='classic_quote' AND l.topic0=0x8e163acc5593cf3fce7106bbacfdb65bd17890d6262590c80bebd3382197a920)
 OR (s.kind='native_ledger' AND l.topic0=0x34579ce58c22de68fe7e545753ced212a5b682a2e81614171dbf2039de2454d8) OR (s.kind='quote_ledger' AND l.topic0 IN (0x3ac225b7f0fd8037879124e884f609edaed1dd2eab0649f13b5b70ed4f63ac86,0x2af0af776b649e399eb457aaa4f4c153142426f58830e2ea2d2d5f102bf7dce2))
 OR (s.kind='legacy_vault' AND l.topic0=0xde7382b4a0346dc5680e562522cef9e22d7597329cfcbe4852da453d00a2fbc9)
 OR (s.kind='custom_component' AND (l.topic0=0x477c82c33085e0da9febf1f975aae54f3dec43d0466a7bddf38484cd90a32957 OR (l.topic0=0xefe2b52a15eefb739f710899cacc48ca85cb7e1935ec83fbb4176e8f9bc5df8a AND varbinary_to_uint256(varbinary_substring(l.data,33,32))=UINT256 '1')))
 ), claims AS (
 SELECT chain_id,block_number,block_time,tx_hash,log_index,source,recipient,asset,max(amount_raw) AS amount_raw,min(proof_block) AS proof_block
 FROM raw_claims WHERE recipient IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c) GROUP BY 1,2,3,4,5,6,7,8
 ), lp_transactions AS (
 SELECT DISTINCT tx_hash,varbinary_substring(topic1,13,20) AS recipient,block_number AS proof_block FROM logs WHERE chain_id=4663 AND contract_address=0x9f9424bbcce8a865f70155fe40fb22a103ebec63 AND topic0=0x0e03635ec70be68229afa80a4b17402fce91d60e7fd3499d709c4271ba408840
 ), lp_token_claims AS (
 SELECT l.chain_id,l.block_number,l.block_time,l.tx_hash,l.log_index,0x9f9424bbcce8a865f70155fe40fb22a103ebec63 AS source,varbinary_substring(l.topic2,13,20) AS recipient,l.contract_address AS asset,varbinary_to_uint256(l.data) AS amount_raw,greatest(l.block_number,p.proof_block) AS proof_block
 FROM logs l JOIN lp_transactions p ON p.tx_hash=l.tx_hash
 WHERE l.chain_id=4663 AND l.topic0=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
 AND varbinary_substring(l.topic1,13,20)=0x8366a39cc670b4001a1121b8f6a443a643e40951 AND l.contract_address=0xc60ba256b44334a0cd2c7242e98b88f031abb006 AND varbinary_substring(l.topic2,13,20)=p.recipient AND varbinary_substring(l.topic2,13,20) IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c)
 ), lp_native_claims AS (
 SELECT 4663 AS chain_id,t.block_number,t.block_time,t.tx_hash,CAST(NULL AS BIGINT) AS log_index,0x9f9424bbcce8a865f70155fe40fb22a103ebec63 AS source,t."to" AS recipient,0x0000000000000000000000000000000000000000 AS asset,sum(t.value) AS amount_raw,greatest(t.block_number,p.proof_block) AS proof_block
 FROM robinhood.traces t JOIN lp_transactions p ON p.tx_hash=t.tx_hash
 WHERE t.block_time>=TIMESTAMP '2026-08-01' AND t.success AND t.tx_success AND t.call_type='call' AND t.value>0
 AND t."from"=0x8366a39cc670b4001a1121b8f6a443a643e40951 AND t."to"=p.recipient AND t."to" IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c) GROUP BY 1,2,3,4,5,6,7,8,10
 ), collected AS (
 SELECT *,'platform_claim' AS revenue_kind FROM claims
 UNION ALL SELECT *,'own_lp_fee' FROM lp_token_claims
 UNION ALL SELECT *,'own_lp_fee' FROM lp_native_claims
 ), finality_boundary AS (
 SELECT max(from_base(coalesce(substr(json_extract_scalar(json_parse(http_post('https://rpc.mainnet.chain.robinhood.com','{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["finalized",false]}',ARRAY['Content-Type: application/json'])),'$.result.number'),3),'FINALITY_UNAVAILABLE'),16)) AS block_number
 ), finalized_heads AS (
 SELECT max(CASE WHEN h.chain_id=1 THEN h.through_block END) AS ethereum_through_block,
 least(max(CASE WHEN h.chain_id=4663 THEN h.through_block END),max(b.block_number)) AS robinhood_through_block
 FROM index_heads h CROSS JOIN finality_boundary b
 ), finalized_collected AS (
 SELECT c.*,h.ethereum_through_block,h.robinhood_through_block
 FROM collected c CROSS JOIN finalized_heads h
 WHERE c.proof_block<=CASE c.chain_id WHEN 1 THEN h.ethereum_through_block ELSE h.robinhood_through_block END
 ), asset_values AS (
 SELECT c.*,CASE WHEN c.asset=0x0000000000000000000000000000000000000000 OR (c.chain_id=4663 AND c.asset=0x0bd7d308f8e1639fab988df18a8011f41eacad73) THEN 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2 ELSE c.asset END AS price_asset,
 CASE WHEN c.asset=0x0000000000000000000000000000000000000000 OR (c.chain_id=4663 AND c.asset=0x0bd7d308f8e1639fab988df18a8011f41eacad73) THEN 'ethereum' WHEN c.chain_id=1 THEN 'ethereum' ELSE 'robinhood' END AS price_chain
 FROM finalized_collected c
 ), priced AS (
 SELECT a.*,p.price,CASE WHEN a.price_asset=0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2 OR a.asset=0xc60ba256b44334a0cd2c7242e98b88f031abb006 THEN 18 ELSE p.decimals END AS decimals,
 NOT(a.chain_id=4663 AND a.asset=0xc60ba256b44334a0cd2c7242e98b88f031abb006 AND a.revenue_kind='own_lp_fee') AS eligible_cash_revenue
 FROM asset_values a LEFT JOIN prices.minute p ON p.blockchain=a.price_chain AND p.contract_address=a.price_asset AND p.timestamp=date_trunc('minute',a.block_time) AND p.timestamp>=TIMESTAMP '2026-07-01'
 ), daily AS (
 SELECT date_trunc('day',block_time) AS day,CASE chain_id WHEN 1 THEN 'Ethereum' ELSE 'Robinhood' END AS chain,
 concat('0x',to_hex(asset)) AS fee_asset,revenue_kind,CAST(sum(amount_raw) AS VARCHAR) AS amount_raw,
 sum(CAST(amount_raw AS DOUBLE)/power(10,decimals)) AS collected_units,
 CASE WHEN count_if(eligible_cash_revenue AND price IS NULL)=0 THEN sum(CASE WHEN eligible_cash_revenue THEN CAST(amount_raw AS DOUBLE)/power(10,decimals)*price ELSE 0 END) END AS eligible_collected_usd,
 sum(CASE WHEN eligible_cash_revenue THEN CAST(amount_raw AS DOUBLE)/power(10,decimals)*price ELSE 0 END) AS priced_collected_subtotal_usd,
 count_if(eligible_cash_revenue AND price IS NULL) AS unpriced_claims,count(*) AS claim_events,
 max(ethereum_through_block) AS ethereum_through_block,
 max(robinhood_through_block) AS robinhood_through_block
 FROM priced GROUP BY 1,2,3,4
 ) SELECT *,CASE WHEN sum(unpriced_claims) OVER ()=0 THEN sum(eligible_collected_usd) OVER () END AS total_eligible_collected_usd,
 sum(priced_collected_subtotal_usd) OVER () AS eligible_priced_subtotal_usd,sum(unpriced_claims) OVER () AS total_unpriced_claims
 FROM daily ORDER BY 1 DESC,2,3
