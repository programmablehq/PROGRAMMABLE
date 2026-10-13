import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const config = JSON.parse(readFileSync(path.join(root, 'docs/analytics/unified/sources.json')));
const quote = x => `'${String(x).replaceAll("'", "''")}'`;
const values = config.sources.map(s => `    (${s.chainId}, ${quote(s.id)}, ${s.address}, BIGINT '${s.startBlock}', ${s.topic0}, ${s.tokenTopic}, ${quote(s.category)})`).join(',\n');
const exclusions = config.technicalExclusions.map(s => `    (${s.chainId}, ${s.address}, ${quote(s.reason)})`).join(',\n');
const zero = '0x0000000000000000000000000000000000000000';
const weth = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const rweth = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
const initialize = '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438';
const swap = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';
const foundationTopics = config.ethereumFoundationEventTopics.join(', ');
const moduleProxies = config.ethereumModuleProxies.map(p => `    (BIGINT '${p.startBlock}', ${p.runtimeCodeHash})`).join(',\n');
const technicalPlans = config.technicalPlans.map(s => `    (${s.chainId}, ${s.launchId})`).join(',\n');
const technicalControllers = config.technicalControllers.map(s => `    (${s.chainId}, ${s.address})`).join(',\n');
const marketStarts = config.planMarketStarts.map(s => `    (${s.chainId}, ${s.stamp}, ${s.launchId}, ${s.poolId}, BIGINT '${s.firstBlock}')`).join(',\n');
const planSources = config.planStampSources.map(s => `    (${s.chainId}, ${s.address}, ${s.stampTopic}, ${s.marketTopic}, ${s.componentTopic})`).join(',\n');

const sql = `-- Programmable ecosystem volume. Generated from sources.json; keep both files together.
-- Each swap event is counted once, never both token legs or an aggregator summary.
-- Current main V4 + installed launch generations in the source manifest on both chains.
-- New launches on these contracts appear automatically. New contract generations must be added.
-- Existing-token launches start at the approved onchain launch block, including the opening buy.
-- Technical release checks are excluded; hiding a real coin in Explore does not erase its history.
-- USD is an estimate from historical prices. Missing prices remain NULL and are counted explicitly.
-- This is executed pool volume: hook fees, transfers, claims and liquidity deposits are not added.
-- Raw v4 events override matching curated DEX rows. Other Dune-covered DEX trades are included.
WITH sources(chain_id, source_id, address, start_block, event_topic, token_topic, category) AS (
  VALUES
${values}
), plan_sources(chain_id, address, stamp_topic, market_topic, component_topic) AS (
  VALUES
${planSources}
), technical_controllers(chain_id, address) AS (
  VALUES
${technicalControllers}
), technical_plans(chain_id, launch_id) AS (
  VALUES
${technicalPlans}
), market_starts(chain_id, stamp, launch_id, pool_id, first_block) AS (
  VALUES
${marketStarts}
), technical_exclusions(chain_id, token, reason) AS (
  VALUES
${exclusions}
), module_proxies(start_block, runtime_code_hash) AS (
  VALUES
${moduleProxies}
), robinhood_finality AS (
  SELECT from_base(coalesce(substr(json_extract_scalar(json_parse(http_post(
    'https://rpc.mainnet.chain.robinhood.com',
    '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["finalized",false]}',
    ARRAY['Content-Type: application/json'])), '$.result.number'), 3), 'FINALITY_UNAVAILABLE'), 16) AS block_number
), raw_heads AS (
  SELECT 1 AS chain_id, least(
    (SELECT max(number)-64 FROM ethereum.blocks WHERE time > current_timestamp-INTERVAL '1' DAY),
    (SELECT max(block_number) FROM ethereum.logs WHERE block_time > current_timestamp-INTERVAL '1' DAY)
  ) AS through_block,
    (SELECT max(block_time) FROM ethereum.logs WHERE block_time > current_timestamp-INTERVAL '1' DAY) AS indexed_at
  UNION ALL
  SELECT 4663, least((SELECT block_number FROM robinhood_finality),
    (SELECT max(block_number) FROM robinhood.logs WHERE block_time > current_timestamp-INTERVAL '1' DAY)),
    (SELECT max(block_time) FROM robinhood.logs WHERE block_time > current_timestamp-INTERVAL '1' DAY)
), heads AS (
  SELECT chain_id,
    coalesce(through_block,CAST(concat('MISSING_CHAIN_HEAD_',CAST(chain_id AS VARCHAR)) AS BIGINT)) AS through_block,
    indexed_at FROM raw_heads
), chain_logs AS (
  SELECT 1 AS chain_id, block_number, block_time, tx_hash, "index" AS log_index,
    contract_address, topic0, topic1, topic2, topic3, data
  FROM ethereum.logs
  WHERE block_time >= TIMESTAMP '2026-07-01' AND block_number >= 25622048
    AND block_number <= (SELECT through_block FROM heads WHERE chain_id=1)
    AND (contract_address IN (SELECT address FROM sources WHERE chain_id=1)
      OR topic0 IN (${foundationTopics}))
  UNION ALL
  SELECT 4663, block_number, block_time, tx_hash, "index",
    contract_address, topic0, topic1, topic2, topic3, data
  FROM robinhood.logs
  WHERE block_time >= TIMESTAMP '2026-08-01'
    AND block_number <= (SELECT through_block FROM heads WHERE chain_id=4663)
    AND (contract_address IN (SELECT address FROM sources WHERE chain_id=4663)
      OR contract_address IN (SELECT address FROM plan_sources WHERE chain_id=4663))
), finalized_plans AS (
  SELECT l.chain_id,l.contract_address,l.topic1 AS launch_id,l.tx_hash,l.block_number,s.market_topic
  FROM chain_logs l JOIN plan_sources s ON l.chain_id=s.chain_id AND l.contract_address=s.address AND l.topic0=s.stamp_topic
  WHERE NOT EXISTS (SELECT 1 FROM technical_controllers t WHERE t.chain_id=l.chain_id AND t.address=varbinary_substring(l.topic2,13,20))
  AND NOT EXISTS (SELECT 1 FROM technical_plans t WHERE t.chain_id=l.chain_id AND t.launch_id=l.topic1)
), plan_markets AS (
  SELECT p.chain_id,varbinary_substring(m.data,13,20) AS pool_manager,m.topic3 AS pool_id,min(coalesce(b.first_block,p.block_number)) AS first_block
  FROM finalized_plans p JOIN chain_logs m ON m.chain_id=p.chain_id AND m.contract_address=p.contract_address
    AND m.tx_hash=p.tx_hash AND m.topic1=p.launch_id AND m.topic0=p.market_topic
  LEFT JOIN market_starts b ON b.chain_id=p.chain_id AND b.stamp=p.contract_address AND b.launch_id=p.launch_id AND b.pool_id=m.topic3
  GROUP BY 1,2,3
), ethereum_module_occurrences AS (
  SELECT DISTINCT f.tx_hash,f.topic1 AS token,c.topic1 AS launch_id,c.contract_address AS router
  FROM chain_logs f JOIN chain_logs c ON c.chain_id=1 AND c.tx_hash=f.tx_hash
    AND c.topic0=${config.componentStampedTopic} AND c.topic2=concat(0x000000000000000000000000,f.contract_address)
    AND varbinary_to_uint256(c.topic3)=UINT256 '0'
  JOIN module_proxies p ON c.data=p.runtime_code_hash AND c.block_number>=p.start_block
  WHERE f.chain_id=1 AND f.topic0 IN (${foundationTopics})
), pool_definitions AS (
  -- An existing-token launch may use a pool created before Programmable existed.
  -- Do not apply the launch-date cutoff to pool discovery.
  SELECT 1 AS chain_id,contract_address,topic1,topic2,topic3
  FROM ethereum.logs
  WHERE contract_address=${config.poolManagers[1]} AND topic0=${initialize}
    AND block_number<=(SELECT through_block FROM heads WHERE chain_id=1)
  UNION ALL
  SELECT 4663,contract_address,topic1,topic2,topic3
  FROM robinhood.logs
  WHERE contract_address=${config.poolManagers[4663]} AND topic0=${initialize}
    AND block_number<=(SELECT through_block FROM heads WHERE chain_id=4663)
), plan_tokens AS (
  SELECT c.chain_id,varbinary_substring(c.topic3,13,20) AS token,min(coalesce(b.first_block,p.block_number)) AS first_block,
    min_by(p.tx_hash,p.block_number) AS tx_hash
  FROM finalized_plans p JOIN plan_sources ps ON ps.chain_id=p.chain_id AND ps.address=p.contract_address
  JOIN chain_logs c ON c.chain_id=p.chain_id AND c.contract_address=p.contract_address
    AND c.tx_hash=p.tx_hash AND c.topic1=p.launch_id AND c.topic0=ps.component_topic
  JOIN chain_logs m ON m.chain_id=p.chain_id AND m.contract_address=p.contract_address
    AND m.tx_hash=p.tx_hash AND m.topic1=p.launch_id AND m.topic0=p.market_topic
  LEFT JOIN market_starts b ON b.chain_id=p.chain_id AND b.stamp=p.contract_address AND b.launch_id=p.launch_id AND b.pool_id=m.topic3
  JOIN pool_definitions d ON d.chain_id=p.chain_id AND d.contract_address=varbinary_substring(m.data,13,20) AND d.topic1=m.topic3
    AND (varbinary_substring(c.topic3,13,20)=varbinary_substring(d.topic2,13,20)
      OR varbinary_substring(c.topic3,13,20)=varbinary_substring(d.topic3,13,20))
  GROUP BY 1,2
), launches AS (
  SELECT l.chain_id, varbinary_substring(CASE s.token_topic
    WHEN 1 THEN l.topic1 WHEN 2 THEN l.topic2 ELSE l.topic3 END,13,20) AS token,
    l.block_number AS first_block, l.block_time AS first_time, l.tx_hash,
    CASE WHEN s.category='custom' AND l.chain_id=1 AND m.tx_hash IS NOT NULL THEN 'module' ELSE s.category END AS category
  FROM chain_logs l JOIN sources s ON s.chain_id=l.chain_id AND s.address=l.contract_address
    AND l.topic0=s.event_topic AND l.block_number>=s.start_block
  LEFT JOIN ethereum_module_occurrences m ON l.chain_id=1 AND m.tx_hash=l.tx_hash AND m.token=l.topic2 AND m.launch_id=l.topic1 AND m.router=l.contract_address
  WHERE s.category<>'registry'
  UNION ALL
  SELECT l.chain_id, varbinary_substring(l.topic3,13,20),
    CAST(varbinary_to_uint256(varbinary_substring(l.data,257,32)) AS BIGINT),
    TIMESTAMP '2026-07-01', l.tx_hash, 'custom'
  FROM chain_logs l JOIN sources s ON s.chain_id=l.chain_id AND s.address=l.contract_address
    AND s.category='registry' AND l.topic0=s.event_topic AND l.block_number>=s.start_block
  WHERE varbinary_length(l.data)=288
    AND varbinary_to_uint256(varbinary_substring(l.data,33,32))=CAST(l.chain_id AS UINT256)
    AND EXISTS (SELECT 1 FROM chain_logs f WHERE f.chain_id=l.chain_id
    AND f.contract_address=l.contract_address AND f.topic1=l.topic1
    AND f.topic0=${config.registryFinalizedTopic})
  UNION ALL
  SELECT chain_id,token,first_block,TIMESTAMP '2026-08-01',tx_hash,'custom' FROM plan_tokens
  UNION ALL
  SELECT ${config.mainCoin.chainId}, ${config.mainCoin.address}, BIGINT '${config.mainCoin.fromBlock}',
    TIMESTAMP '2026-08-01', CAST(NULL AS VARBINARY), 'main'
), identities AS (
  SELECT chain_id, token, min(first_block) AS first_block, min(first_time) AS first_time,
    min_by(category, CASE category WHEN 'main' THEN 0 WHEN 'module' THEN 1 WHEN 'custom' THEN 2 ELSE 3 END) AS category
  FROM launches l
  WHERE token<>${zero}
    AND NOT EXISTS (SELECT 1 FROM technical_exclusions e WHERE e.chain_id=l.chain_id AND e.token=l.token)
  GROUP BY 1,2
), known_pools AS (
  SELECT l.chain_id, l.contract_address AS pool_manager, l.topic1 AS pool_id,
    varbinary_substring(l.topic2,13,20) AS currency0, varbinary_substring(l.topic3,13,20) AS currency1,
    min(i.first_block) AS first_block,
    min_by(i.category,CASE i.category WHEN 'main' THEN 0 WHEN 'module' THEN 1 WHEN 'custom' THEN 2 ELSE 3 END) AS category
  FROM pool_definitions l JOIN identities i ON i.chain_id=l.chain_id
    AND (i.token=varbinary_substring(l.topic2,13,20) OR i.token=varbinary_substring(l.topic3,13,20))
  GROUP BY 1,2,3,4,5
  UNION ALL
  SELECT p.chain_id,p.pool_manager,p.pool_id,varbinary_substring(l.topic2,13,20),varbinary_substring(l.topic3,13,20),
    p.first_block,'custom'
  FROM plan_markets p JOIN pool_definitions l ON l.chain_id=p.chain_id AND l.contract_address=p.pool_manager AND l.topic1=p.pool_id
), pools AS (
  SELECT chain_id,pool_manager,pool_id,currency0,currency1,min(first_block) AS first_block,
    min_by(category,CASE category WHEN 'main' THEN 0 WHEN 'module' THEN 1 ELSE 2 END) AS category
  FROM known_pools GROUP BY 1,2,3,4,5
), swap_logs AS (
  SELECT 1 AS chain_id,block_number,block_time,tx_hash,"index" AS log_index,contract_address,topic1,data
  FROM ethereum.logs WHERE contract_address=${config.poolManagers[1]} AND topic0=${swap}
    AND block_time>=TIMESTAMP '2026-07-01' AND block_number<=(SELECT through_block FROM heads WHERE chain_id=1)
  UNION ALL
  SELECT 4663,block_number,block_time,tx_hash,"index",contract_address,topic1,data
  FROM robinhood.logs WHERE contract_address=${config.poolManagers[4663]} AND topic0=${swap}
    AND block_time>=TIMESTAMP '2026-08-01' AND block_number<=(SELECT through_block FROM heads WHERE chain_id=4663)
), raw_v4 AS (
  SELECT l.chain_id,l.block_number,l.block_time,l.tx_hash,l.log_index,p.category,p.currency0,p.currency1,
    abs(CAST(varbinary_to_int256(varbinary_substring(l.data,1,32)) AS DOUBLE)) AS amount0_raw,
    abs(CAST(varbinary_to_int256(varbinary_substring(l.data,33,32)) AS DOUBLE)) AS amount1_raw,
    CASE WHEN p.currency0=${zero} OR (l.chain_id=4663 AND p.currency0=${rweth}) THEN 'ethereum'
      WHEN l.chain_id=1 THEN 'ethereum' ELSE 'robinhood' END AS price_chain0,
    CASE WHEN p.currency1=${zero} OR (l.chain_id=4663 AND p.currency1=${rweth}) THEN 'ethereum'
      WHEN l.chain_id=1 THEN 'ethereum' ELSE 'robinhood' END AS price_chain1,
    CASE WHEN p.currency0=${zero} OR (l.chain_id=4663 AND p.currency0=${rweth}) THEN ${weth} ELSE p.currency0 END AS price_asset0,
    CASE WHEN p.currency1=${zero} OR (l.chain_id=4663 AND p.currency1=${rweth}) THEN ${weth} ELSE p.currency1 END AS price_asset1
  FROM swap_logs l JOIN pools p ON p.chain_id=l.chain_id AND p.pool_manager=l.contract_address AND p.pool_id=l.topic1
  WHERE varbinary_length(l.data)=192 AND l.block_number>=p.first_block
), v4_values AS (
  SELECT v.*,
    nullif(v.amount0_raw/power(10,p0.decimals)*p0.price,0) AS usd0,
    nullif(v.amount1_raw/power(10,p1.decimals)*p1.price,0) AS usd1,
    i0.token IS NOT NULL AS currency0_is_launch
  FROM raw_v4 v LEFT JOIN prices.minute p0 ON p0.blockchain=v.price_chain0 AND p0.contract_address=v.price_asset0
    AND p0.timestamp=date_trunc('minute',v.block_time)
    AND p0.timestamp>=TIMESTAMP '2026-07-01' AND p0.blockchain IN ('ethereum','robinhood')
    AND p0.price>0 AND p0.decimals BETWEEN 0 AND 36
  LEFT JOIN prices.minute p1 ON p1.blockchain=v.price_chain1 AND p1.contract_address=v.price_asset1
    AND p1.timestamp=date_trunc('minute',v.block_time)
    AND p1.timestamp>=TIMESTAMP '2026-07-01' AND p1.blockchain IN ('ethereum','robinhood')
    AND p1.price>0 AND p1.decimals BETWEEN 0 AND 36
  LEFT JOIN identities i0 ON i0.chain_id=v.chain_id AND i0.token=v.currency0
), v4_trades AS (
  SELECT chain_id,block_number,block_time,tx_hash,log_index,category,'v4-log' AS source,
    CASE WHEN price_asset0=${weth} THEN coalesce(usd0,usd1)
      WHEN price_asset1=${weth} THEN coalesce(usd1,usd0)
      WHEN currency0_is_launch THEN coalesce(usd1,usd0)
      ELSE coalesce(usd0,usd1) END AS volume_usd
  FROM v4_values v
), other_dex_matches AS (
  SELECT i.chain_id,d.block_number,d.block_time,d.tx_hash,d.evt_index AS log_index,
    min_by(i.category,CASE i.category WHEN 'main' THEN 0 WHEN 'module' THEN 1 WHEN 'custom' THEN 2 ELSE 3 END) AS category,
    max(d.amount_usd) AS volume_usd
  FROM dex.trades d JOIN identities i ON d.blockchain=CASE i.chain_id WHEN 1 THEN 'ethereum' ELSE 'robinhood' END
    AND (d.token_bought_address=i.token OR d.token_sold_address=i.token)
    AND d.block_number>=i.first_block
  JOIN heads h ON h.chain_id=i.chain_id AND d.block_number<=h.through_block
  WHERE d.blockchain IN ('ethereum','robinhood') AND d.block_time>=TIMESTAMP '2026-07-01'
    AND d.evt_index IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM raw_v4 v WHERE v.chain_id=i.chain_id AND v.tx_hash=d.tx_hash AND v.log_index=d.evt_index)
  GROUP BY 1,2,3,4,5
), trades AS (
  SELECT * FROM v4_trades
  UNION ALL
  SELECT chain_id,block_number,block_time,tx_hash,log_index,category,'dex.trades',volume_usd FROM other_dex_matches
), deduped AS (
  SELECT *,row_number() OVER (PARTITION BY chain_id,tx_hash,log_index ORDER BY source DESC) AS event_rank FROM trades
), daily AS (
  SELECT date_trunc('day',block_time) AS day,chain_id,category,
    sum(volume_usd) AS volume_usd,count(*) AS swaps,
    count_if(volume_usd IS NULL) AS unpriced_swaps,
    count_if(source='v4-log') AS raw_v4_swaps,max(block_time) AS last_trade_at
  FROM deduped WHERE event_rank=1 GROUP BY 1,2,3
)
SELECT day,CASE chain_id WHEN 1 THEN 'Ethereum' ELSE 'Robinhood' END AS chain,category,
  volume_usd,swaps,unpriced_swaps,raw_v4_swaps,last_trade_at,
  CASE WHEN sum(unpriced_swaps) OVER ()=0 THEN sum(volume_usd) OVER () END AS ecosystem_volume_usd,
  sum(volume_usd) OVER () AS ecosystem_priced_subtotal_usd,
  sum(unpriced_swaps) OVER () AS ecosystem_unpriced_swaps,
  sum(swaps) OVER () AS ecosystem_swaps,
  CASE WHEN sum(CASE WHEN day>=date_trunc('day',current_timestamp)-INTERVAL '6' DAY THEN unpriced_swaps ELSE 0 END) OVER ()=0
    THEN sum(CASE WHEN day>=date_trunc('day',current_timestamp)-INTERVAL '6' DAY THEN volume_usd ELSE 0 END) OVER ()
    END AS last_7_calendar_days_volume_usd,
  (SELECT count(*) FROM identities WHERE category<>'main') AS launched_tokens,
  (SELECT through_block FROM heads WHERE chain_id=1) AS ethereum_through_block,
  (SELECT through_block FROM heads WHERE chain_id=4663) AS robinhood_through_block,
  (SELECT min(indexed_at) FROM heads) AS indexed_through_at_least,
  CASE WHEN (SELECT min(indexed_at) FROM heads)<current_timestamp-INTERVAL '1' HOUR
    THEN 'DELAYED: chain indexing is more than one hour behind' ELSE 'Chain indexing current within one hour' END AS indexing_status,
  CASE WHEN sum(unpriced_swaps) OVER ()>0 THEN 'PARTIAL: some swaps have no USD price' ELSE 'All observed swaps priced' END AS pricing_status
FROM daily ORDER BY day DESC,chain,category
`;
const output=path.join(root,'docs/analytics/unified/ecosystem-volume.sql');
if (process.argv.includes('--check')) {
  if(readFileSync(output,'utf8')!==sql) throw new Error('Generated SQL is out of date');
} else writeFileSync(output,sql);
console.log(JSON.stringify({sources:config.sources.length,bytes:Buffer.byteLength(sql),output:'docs/analytics/unified/ecosystem-volume.sql'}));
