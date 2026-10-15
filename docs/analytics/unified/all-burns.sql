-- All finalized V4 transfers to the burn address on Robinhood Chain.
-- All holders remain included; project totals combine the three disclosed fee wallets.
-- Transfers to dead do not reduce ERC-20 totalSupply.
-- RPC ranges are chunked below the provider limit. Block times use Dune or RPC.
WITH finalized_response AS (
    SELECT json_parse(http_post(
        'https://rpc.mainnet.chain.robinhood.com',
        '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["finalized",false]}',
        ARRAY['Content-Type: application/json']
    )) AS reply
), finalized_head AS (
    SELECT from_base(coalesce(substr(json_extract_scalar(reply, '$.result.number'), 3), 'RPC_FINALITY_MISSING'), 16) AS final_block
    FROM finalized_response
), block_ranges AS (
    SELECT first_block, least(first_block + BIGINT '9999999', final_block) AS last_block
    FROM finalized_head CROSS JOIN UNNEST(sequence(BIGINT '0', final_block, BIGINT '10000000')) AS b(first_block)
), rpc_response AS (
    SELECT reply
    FROM block_ranges CROSS JOIN UNNEST(ARRAY[json_parse(http_post(
        'https://rpc.mainnet.chain.robinhood.com',
        concat('{"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{"fromBlock":"0x', to_base(first_block, 16), '","toBlock":"0x', to_base(last_block, 16), '","address":"0xc60ba256b44334a0cd2c7242e98b88f031abb006","topics":["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",null,"0x000000000000000000000000000000000000000000000000000000000000dead"]}]}'),
        ARRAY['Content-Type: application/json']
    ))]) AS r(reply)
), log_documents AS (
    SELECT document
    FROM rpc_response
    CROSS JOIN UNNEST(CAST(json_parse(
        CASE WHEN substr(json_format(json_extract(reply, '$.result')), 1, 1) = '['
             THEN json_format(json_extract(reply, '$.result'))
             ELSE concat('RPC_LOGS_ERROR: ', json_format(reply))
        END
    ) AS ARRAY(JSON))) AS l(document)
), decoded AS (
    SELECT
        varbinary_to_uint256(from_hex(substr(json_extract_scalar(document, '$.data'), 3))) AS amount_raw,
        varbinary_substring(from_hex(substr(json_extract_scalar(document, '$.topics[1]'), 3)), 13, 20) AS sender,
        from_hex(substr(json_extract_scalar(document, '$.transactionHash'), 3)) AS tx_hash,
        from_base(substr(json_extract_scalar(document, '$.blockNumber'), 3), 16) AS block_number,
        from_base(substr(json_extract_scalar(document, '$.logIndex'), 3), 16) AS log_index
    FROM log_documents
    WHERE lower(json_extract_scalar(document, '$.address')) = '0xc60ba256b44334a0cd2c7242e98b88f031abb006'
      AND json_extract_scalar(document, '$.topics[0]') = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
      AND json_extract_scalar(document, '$.topics[2]') = '0x000000000000000000000000000000000000000000000000000000000000dead'
      AND COALESCE(json_extract_scalar(document, '$.removed'), 'false') = 'false'
), ranked AS (
    SELECT *, row_number() OVER (PARTITION BY tx_hash, log_index ORDER BY block_number) AS duplicate_rank
    FROM decoded
    WHERE amount_raw > UINT256 '0'
), timed AS (
    SELECT r.amount_raw, r.sender, r.tx_hash, r.block_number, r.log_index,
        indexed.indexed_time, block_response
    FROM ranked r
    LEFT JOIN (
        SELECT tx_hash, "index" AS log_index, max(block_time) AS indexed_time
        FROM robinhood.logs
        WHERE contract_address = 0xc60ba256b44334a0cd2c7242e98b88f031abb006
          AND topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
          AND topic2 = 0x000000000000000000000000000000000000000000000000000000000000dead
        GROUP BY tx_hash, "index"
    ) indexed ON indexed.tx_hash = r.tx_hash AND indexed.log_index = r.log_index
    CROSS JOIN UNNEST(ARRAY[
        CASE WHEN indexed.indexed_time IS NULL THEN json_parse(http_post(
            'https://rpc.mainnet.chain.robinhood.com',
            concat('{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["0x', to_base(r.block_number, 16), '",false]}'),
            ARRAY['Content-Type: application/json']
        )) ELSE CAST(NULL AS JSON) END
    ]) AS b(block_response)
    WHERE r.duplicate_rank = 1
), timestamps AS (
    SELECT *,
        CASE WHEN indexed_time IS NULL THEN
            from_base(coalesce(substr(json_extract_scalar(block_response, '$.result.timestamp'), 3), 'RPC_TIMESTAMP_MISSING'), 16)
        END AS rpc_timestamp
    FROM timed
), burns AS (
    SELECT amount_raw, sender, tx_hash, block_number, log_index,
        coalesce(indexed_time, CAST(from_unixtime(
            CASE WHEN rpc_timestamp > 0 THEN rpc_timestamp
                 ELSE from_base(concat('RPC_TIMESTAMP_INVALID_', coalesce(CAST(rpc_timestamp AS VARCHAR), 'NULL')), 16)
            END
        ) AT TIME ZONE 'UTC' AS TIMESTAMP)) AS burn_time,
        row_number() OVER (PARTITION BY tx_hash ORDER BY log_index) AS tx_rank
    FROM timestamps
), metrics AS (
    SELECT *,
        sum(amount_raw) OVER () AS total_raw,
        sum(CASE WHEN sender IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62) THEN amount_raw ELSE UINT256 '0' END) OVER () AS project_total_raw,
        sum(CASE WHEN sender=0x39544a7023081b56d7405c1af0bfaf72da7e24f6 THEN amount_raw ELSE UINT256 '0' END) OVER () AS primary_burn_wallet_raw,
        sum(amount_raw) OVER (ORDER BY block_number, log_index ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative_raw,
        sum(CASE WHEN tx_rank = 1 THEN 1 ELSE 0 END) OVER () AS burn_transactions
    FROM burns
)
SELECT burn_time AS burn_time_utc,
    CAST(amount_raw AS DOUBLE) / 1e18 AS v4_burned,
    get_href(concat('https://robinhoodchain.blockscout.com/address/0x', lower(to_hex(sender))), concat('0x', substr(lower(to_hex(sender)), 1, 6), '...', substr(lower(to_hex(sender)), 36, 5))) AS sender,
    get_href(concat('https://robinhoodchain.blockscout.com/tx/0x', lower(to_hex(tx_hash))), 'View transaction') AS transaction,
    CAST(cumulative_raw AS DOUBLE) / 1e18 AS cumulative_v4,
    CAST(total_raw AS DOUBLE) / 1e18 AS total_v4_burned,
    CAST(total_raw AS DOUBLE) / 1e18 / 1000000000.0 * 100.0 AS supply_burned_pct,
    burn_transactions,
    concat(CAST(amount_raw / UINT256 '1000000000000000000' AS VARCHAR), '.', lpad(CAST(amount_raw % UINT256 '1000000000000000000' AS VARCHAR), 18, '0')) AS exact_v4_burned,
    CAST(amount_raw AS VARCHAR) AS amount_raw,
    concat('0x', lower(to_hex(tx_hash))) AS transaction_hash,
    block_number,
    log_index,
    concat('0x',lower(to_hex(sender))) AS sender_address,
    CASE WHEN sender IN (0xd88539d3c4c460136a733a3fd60cf6bf269079da,0x39544a7023081b56d7405c1af0bfaf72da7e24f6,0x4957f49620aff3adbbe8195a4f633e49cc93376c,0x9f5856a3578faba96a6e8dfd9c10563a1e598f62) THEN 'Programmable project wallet' ELSE 'Other holder' END AS burn_source,
    CAST(project_total_raw AS DOUBLE)/1e18 AS project_v4_burned,
    CAST(primary_burn_wallet_raw AS DOUBLE)/1e18 AS primary_wallet_v4_burned,
    (SELECT final_block FROM finalized_head) AS through_block
FROM metrics
ORDER BY block_number DESC, log_index DESC
