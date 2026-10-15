-- Project burns, separated by token generation. Transfers do not imply totalSupply reduction.
WITH heads AS (
 SELECT 1 AS chain_id, (SELECT max(number)-64 FROM ethereum.blocks WHERE time>current_timestamp-INTERVAL '1' DAY) AS through_block
 UNION ALL SELECT 4663,least((SELECT max(block_number) FROM robinhood.logs WHERE block_time>current_timestamp-INTERVAL '1' DAY),
 from_base(substr(json_extract_scalar(json_parse(http_post('https://rpc.mainnet.chain.robinhood.com','{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["finalized",false]}',ARRAY['Content-Type: application/json'])),'$.result.number'),3),16))
), logs AS (
 SELECT 1 AS chain_id,block_number,block_time,tx_hash,"index" AS log_index,topic1,topic2,data FROM ethereum.logs
 WHERE contract_address=0x7987f03462200b3d8a072e02c89a8a41dcb124ee AND topic0=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef AND block_time>=TIMESTAMP '2026-07-01'
 UNION ALL
 SELECT 4663,block_number,block_time,tx_hash,"index",topic1,topic2,data FROM robinhood.logs
 WHERE contract_address=0xc60ba256b44334a0cd2c7242e98b88f031abb006 AND topic0=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef AND block_time>=TIMESTAMP '2026-08-01'
)
SELECT CASE l.chain_id WHEN 1 THEN 'Ethereum' ELSE 'Robinhood' END AS chain,
 l.block_time AS burn_time_utc,concat('0x',to_hex(l.tx_hash)) AS transaction_hash,l.log_index,
 concat('0x',to_hex(varbinary_substring(l.topic1,13,20))) AS sender_address,
 CAST(varbinary_to_uint256(l.data) AS VARCHAR) AS amount_raw,
 CAST(varbinary_to_uint256(l.data) AS DOUBLE)/1e18 AS v4_burned,l.block_number,h.through_block
FROM logs l JOIN heads h ON h.chain_id=l.chain_id
WHERE l.block_number<=h.through_block
AND varbinary_substring(l.topic1,13,20) IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62)
AND varbinary_substring(l.topic2,13,20) IN (0x000000000000000000000000000000000000dead,0x0000000000000000000000000000000000000000)
ORDER BY l.block_time DESC,l.log_index DESC
