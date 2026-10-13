-- Programmable ecosystem volume. Generated from sources.json; keep both files together.
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
    (1, 'custom-router-8622DD', 0x8622dd5bab44185f2a458ac90384ac99248f8d56, BIGINT '25717612', 0x6cf479a102f1eebc9244f48f8d68f6aa52b4c5a4516318df58ba46614a5b14f2, 2, 'custom'),
    (1, 'custom-router-BE4bF6', 0xbe4bf6ac8c6f012e1c8f25747a9fbccb2fdac4c3, BIGINT '26152286', 0x6cf479a102f1eebc9244f48f8d68f6aa52b4c5a4516318df58ba46614a5b14f2, 2, 'custom'),
    (4663, 'custom-router-34965F', 0x34965f2a2ee9254522232c32f02056e92be0c98a, BIGINT '50469365', 0x6cf479a102f1eebc9244f48f8d68f6aa52b4c5a4516318df58ba46614a5b14f2, 2, 'custom'),
    (4663, 'legacy-custom-v2-9fd629', 0x9fd629cd1eb47fb20813c2403153714b523f681e, BIGINT '50469365', 0x4916167b998f441a46d1e4bc734a855746d34935136a4b3bc2575f7cf5682e1e, 2, 'custom'),
    (4663, 'legacy-custom-v2-4b5cec', 0x4b5cec6e715c3bcd7e6837e9e307c40c9acc2b2e, BIGINT '50469365', 0x4916167b998f441a46d1e4bc734a855746d34935136a4b3bc2575f7cf5682e1e, 2, 'custom'),
    (4663, 'module-native-v1', 0x351cb006f7aaf61374be4be4de8572d62d89fd83, BIGINT '56160214', 0x6570caeda0af26be073c30ae27c5f864331d28dab3bf14b31aa3e5bf64793e85, 3, 'module'),
    (4663, 'module-native-v2', 0x362dac28ac64ce11989a90e0da6715313e0162c5, BIGINT '57167553', 0x6570caeda0af26be073c30ae27c5f864331d28dab3bf14b31aa3e5bf64793e85, 3, 'module'),
    (4663, 'foundation-v1-32897c', 0x32897c76e4e87d72f404f33f01e4ef2a76931286, BIGINT '64005092', 0xb49f0564306d89078cb0b3ba713483e150fb77b5a00026fd9be477c471383d34, 1, 'module'),
    (4663, 'foundation-v2-c02a2b', 0xc02a2bebecb60c8d2e9e0176a4438845eae66a5c, BIGINT '66023586', 0x6170d19d4db2409523b652a3bf190bc7629b0a1af2e5118536ecd4b62364b099, 1, 'module'),
    (4663, 'foundation-v2-31bce4', 0x31bce40a6d28db69bf0b6cd0abc5d8f506626acc, BIGINT '66969916', 0x6170d19d4db2409523b652a3bf190bc7629b0a1af2e5118536ecd4b62364b099, 1, 'module'),
    (4663, 'foundation-v2-18cab1', 0x18cab14c69d0fe6df4a96256318b51c51c98da3f, BIGINT '67353984', 0x6170d19d4db2409523b652a3bf190bc7629b0a1af2e5118536ecd4b62364b099, 1, 'module'),
    (4663, 'module-engine-v1', 0x4ee5822de7296df5959085b95762f8c1c63da614, BIGINT '57168845', 0xff4443f26f19ee686578c2ab781ba148b352618958c1a84339db55de60a9a471, 2, 'module'),
    (4663, 'module-engine-any-quote-eth-v1', 0xcec7d7a0fd6dabe473f3aff998eb054f161924e2, BIGINT '60331314', 0xff4443f26f19ee686578c2ab781ba148b352618958c1a84339db55de60a9a471, 2, 'module'),
    (1, 'mainnet-classic-v1', 0x51d702731db281ee223904a4663e05bfca26c775, BIGINT '25622048', 0x54f861f401872200b25acd4a9f53153ac06a7be4562b3e43025a4a85740a5675, 2, 'classic'),
    (1, 'mainnet-classic-v2', 0xd240d06f8586eb799f20056054e5b527405e6bad, BIGINT '25624128', 0x54f861f401872200b25acd4a9f53153ac06a7be4562b3e43025a4a85740a5675, 2, 'classic'),
    (1, 'mainnet-classic-v3', 0xc3bd04aac2fb2ba58efd7eb673e544e0b80de770, BIGINT '25639596', 0xf23bd7fdf96caf9195ba5982de473632f59015abc714915dfbbe06cbd8e255e5, 2, 'classic'),
    (1, 'mainnet-classic-v4', 0xbbdf30a2fe1394e4aa864ac269c6cf09b518e699, BIGINT '25853086', 0xf23bd7fdf96caf9195ba5982de473632f59015abc714915dfbbe06cbd8e255e5, 2, 'classic'),
    (1, 'mainnet-stock-paired-v1', 0x195750f33cad5ef2df857a53226b421297a1e79e, BIGINT '25637469', 0xe33bd69b6e794281bc106d622fbe0c587aeabf86d1ca4d1afcd583cf8a3e8935, 2, 'classic'),
    (1, 'mainnet-stock-paired-v2', 0x5ea6be24838061ba45dbe8d82de1b267dc240daf, BIGINT '25640338', 0xe33bd69b6e794281bc106d622fbe0c587aeabf86d1ca4d1afcd583cf8a3e8935, 2, 'classic'),
    (1, 'mainnet-stock-paired-v3', 0x0573879f72d8ee8b0e5a4ec5e8bcdb2fcab9e51c, BIGINT '25642745', 0xe33bd69b6e794281bc106d622fbe0c587aeabf86d1ca4d1afcd583cf8a3e8935, 2, 'classic'),
    (1, 'legacy-deep-v1', 0x7aef9a4038fabb1d477bbfd3a106f81b93eb5aeb, BIGINT '25632886', 0x4c037a8fed83af4d4d43f2ce482432dda5126aa3209ce74a6ae90c37fbab7681, 2, 'classic'),
    (1, 'registry-v1', 0x17e18c88bda9bfb73924cdc989c07b0707e72671, BIGINT '25701139', 0x8ee074138114415a92a0797b4f1f4c6353f8bd15d8031433abf0cc42c2dc274a, 3, 'registry'),
    (4663, 'foundation-v3-a3479c', 0xa3479cb16fdb71b706b8961dc50be6404c05c7ea, BIGINT '86465251', 0xc3c5d5e4abbd15966e584a111dd56b7568327d03138a9bb801993be4c37618c1, 1, 'module')
), plan_sources(chain_id, address, stamp_topic, market_topic, component_topic) AS (
  VALUES
    (4663, 0xe21827818fea1f14d59929cae36a93c0b44e0ae1, 0x15ceb1b49fa6ac04c745019a219162db39b20faa1ca2ffe9bbd5f588ee833f36, 0x098e8758005424f77cde00555884a6409aa31ecea0025b32b6f767ed199a2f87, 0x1dfc3e9bdf26ebc4d1d63607a4201889c3ee884f57830f78c271eb25cc1027bc),
    (4663, 0xb2a5eba2554aae969bc513a59c1d676e3400e11e, 0x6b7bc0903feed213f29c6f4f1707d5961d2609db0666a511204ec69b1e0931e8, 0x63ebf2f745324f15273949b24ca7b06788717f4f11d5110a512b2d325f6fee27, 0xb212a385de739a6a3bd51dadd2e23dddbf51b36083effd98c0648d2f081097f3),
    (4663, 0x3d3470550c2d14c61e4611c5a010c5d7c53f16fe, 0x6b7bc0903feed213f29c6f4f1707d5961d2609db0666a511204ec69b1e0931e8, 0x63ebf2f745324f15273949b24ca7b06788717f4f11d5110a512b2d325f6fee27, 0xb212a385de739a6a3bd51dadd2e23dddbf51b36083effd98c0648d2f081097f3),
    (4663, 0x0ad35ef4aa70d4c31a2a44fb3cc8ebfcb253275e, 0x15ceb1b49fa6ac04c745019a219162db39b20faa1ca2ffe9bbd5f588ee833f36, 0x098e8758005424f77cde00555884a6409aa31ecea0025b32b6f767ed199a2f87, 0x1dfc3e9bdf26ebc4d1d63607a4201889c3ee884f57830f78c271eb25cc1027bc)
), technical_controllers(chain_id, address) AS (
  VALUES
    (4663, 0x0dbe4f551b318fbba7e7a1975c3a62b9392b8595)
), technical_plans(chain_id, launch_id) AS (
  VALUES
    (4663, 0xec2dcdc92cec6caadc6058484e12e3121f27d097978d1040f4a346112280e099),
    (4663, 0x8a0c8d6aae04037d2d32247d388775f132108040d6fadf1907ddc26c4d4902dc),
    (4663, 0xa0df00238f6c95ff31e7c3f3509762b8c2774be56e5d5a26117fb8b138633389),
    (4663, 0x08bf6c9517414bab06abebd4996b286348a7465f0d998039750a0f51a7212453),
    (4663, 0x1765503dabc79696c44f4ccbeb806d37bfe4907fa3c9b8d12dcba69f2a50475f),
    (4663, 0xcbde105b83d40806228dcbdcd7e67d1320e0c1b8c5737b062c6ffabdbae299f9),
    (4663, 0x4f0df26a594cd001b04edd5be71efaea1d6103f9f06f5a1a161b0d2974159ba5),
    (4663, 0xad5bcbc86ac653d42e7617907f1dedeede415fa449ad2e8f08ef1c0e514a0d7d),
    (4663, 0xcf3ed6846e0b96b34fd26e26b11621432e9027ac92b5ff33414517f0dd29ded8),
    (4663, 0x3370fa3b5a2013086c5a730aa80e93dadc77c33d74fb7de63199c49e7df2f593),
    (4663, 0x91f6dde615c7275de46860a12e12bec94539d5097b39a1ad021dffcaaa3b956f),
    (4663, 0x3c20e172df4556c2e4758c6d5f780097c9074ca2f12f68102fd91f92beb38ea1),
    (4663, 0x606de74d15163f5945c5062dc1a03549e09515a3716ea46d216862e6e55840d7),
    (4663, 0xf1ffedaaff5bf1f4f4a3d9abaf4875da090e04d00529cac5536d73b61159c035),
    (4663, 0x37aa5acab4a6adbd4f2ac9b912d32d157f2a62be1933eaf9ac3a50cd491f25f2),
    (4663, 0xaff475e3e2a16f92433275e1997e4be8c6b390074a33a0c2d3967ef15bde5f75),
    (4663, 0xcd36439d583ec5ef86669e2a3d461c8cdaf7a15dd9141d10d62dd24c414d19c1),
    (4663, 0xf8445df9dc31ea7d6792ccf0afb980c16f04f7f5cbb0f21f43720c085939014e),
    (4663, 0x5e5c042f09d1b8d80bd3a625b634f13cbe22b87cf021f83aaac4dbcd842c6c72),
    (4663, 0x52a97bd5b3897829ebbf9085e464dab50fa11b713fee13b17b9110c1790945cd),
    (4663, 0x1a6ff418e0b6a685c93eab8ffd5a59b4fc8ed244b351b3de8caff345ac484b72),
    (4663, 0x6c922ffeafc2dec1cfd5627bd96a5799d75d40d1cd0c8ba5d38ef99caf4f8082),
    (4663, 0x1435c2783b7143cd8bc1c7c705661aa0a628a2f1ce0b53b0bd8877e4f3e7f57f),
    (4663, 0xf3bdc020d7f16e36568979e318e294e859328e92d41eb1951083d0ac0276db9c),
    (4663, 0x88d846e99698522283edb96eb8522898ce71d6f472b7f7cdb8da3e5e58fa5793),
    (4663, 0x03d19398c0c834fca29a8e4d8d721be6c389a5436e3de5301ccc8736e83b9c9c),
    (4663, 0x804945c9bd6057086215d68fa0d2e1c267568c2176e0ec5efe88a082523cd833),
    (4663, 0xf0afa8c53abe4fcd007ef7b597d9e4580f0c17692868bd8fbf438b1cd2220397),
    (4663, 0xc63620a3b5cd8f9d9b8afc1cf351b1e447947bcb96f2b34bd583f9d70b18d88b),
    (4663, 0xcfe7f13e573f397c9537301cbecc1dc9336040a4d68eb6960313341f44190180),
    (4663, 0x9cffa820cf12a6fa5048a927fa59a3bc83bd5a94d6d7f8d6387d8c92ace49b3c),
    (4663, 0x5234ead87283fa8a223684716afd48438977d560212d82e0ea17735752afad6d),
    (4663, 0xaf38a2e5efe672815c7a617bf1add9c00fd77ae5f223b6ce01fa0fa8ef4b73f0),
    (4663, 0x4065c43dc4482a0e03b7806ac193bb09be234624a3119497ef9f83166f6af312),
    (4663, 0x79801800ebe99eb528f27e400274102d943f788f4a5d419968d0d77c4a8f809d),
    (4663, 0x1039bd4aa55e8f78273a426963473dd164ab8125efcd709bf1eaa09357c4ed55),
    (4663, 0xfbacd0ec84c9b1bb05a5b5fb15db088a1d1e3c0ad372ee4d1423b7e661fac151),
    (4663, 0x95557fcecdc5e11abf38aa93ca3af8baf146c34670f4affe41f2efe28b02044b)
), market_starts(chain_id, stamp, launch_id, pool_id, first_block) AS (
  VALUES
    (4663, 0xb2a5eba2554aae969bc513a59c1d676e3400e11e, 0x9cf7593503ebc94cbeb4b095752d8d19413daf15051e61e46e50e359c1e98e9c, 0x42ec1363a3799fa48e951ccff51628ff8338223d16d5a11bc99be33d4f77afa7, BIGINT '87259720')
), technical_exclusions(chain_id, token, reason) AS (
  VALUES
    (1, 0xb382f738a99820276fd66efb94b75eca104c2b4d, 'documented-release-canary'),
    (1, 0xfa5d9694d9f8fa47b8a6c15df4510b76cb844e2c, 'documented-release-canary'),
    (1, 0x3a778578b3a21dd842c29be3d1816b1af37d54f3, 'documented-release-canary'),
    (1, 0x3c82787014931bd11b9edb789e42f92d792dd07f, 'documented-release-canary'),
    (1, 0x369f5fa21942560c42ba9fdb8a156f5c962bd2ec, 'documented-release-canary'),
    (1, 0x2c348590cb56fcc5984f035d57bdb01e32c945d5, 'documented-release-canary'),
    (1, 0x9deeb39d2590b0cad5fc473f755c5f97dcc8f7ce, 'documented-release-canary'),
    (4663, 0xc657ade283727d6ad1ae85cdb888c47d751e8ab8, 'Owned review-cache release check; bound to review d2c8670e-dc49-4c57-9030-d3174d09fae4'),
    (4663, 0x0e6990f83be3b72adbece8a870b7264510ce3e46, 'Owned child-effect release check; deterministic token bound to review 14057e62-580a-4f99-9406-7c33b426f84d'),
    (4663, 0x40ad95a531caf7657fc40c50c3d6dbdad6f70baf, 'Owned API readiness release check; deterministic token bound to review 946ba9ca-ca89-49be-b4f0-8306f2e0680e'),
    (4663, 0xe5335f382444efdedbe23ef6b0b91ea385812b57, 'Owned launch-operations release check; deterministic token bound to review 00adf0c8-0054-4075-83b9-d88d617f83f7'),
    (4663, 0xe0a557b41a13dd0ff3378c13ac700d7515cc79e8, 'Preparation-feedback release check; tx 0x05572442b8ea459bf2ee2e2583bfa5f8d66fe9a065e40aac562fdbabef1713d9'),
    (4663, 0x734b0dc83c29b9da80d5c733815f705a8b6f9d5e, 'Manual-review checkpoint release check'),
    (4663, 0x8b69fd6e401039e45444eea5d99e59a4122d859a, 'Source-verification release check'),
    (4663, 0xf9261d85c503927bf70916a6594a33979e614ec3, 'Replacement admission API release check'),
    (4663, 0x2a0836901fd30be8de47b9c199c6acf2ba372305, 'Economic module API release check'),
    (4663, 0x76f71862c7646c3f6a54312a0889097a7334a8c0, 'Compiler and atomic-stamp release canary'),
    (1, 0x705f60fadb9728ca976e727ae9d746cc4d303be2, 'ETH 3.6 release canary'),
    (1, 0xbb73f3bb5cfae5629f0a6a58bb10ab1e35e4c11a, 'Atomic module-stamp release canary'),
    (1, 0x2bbc1677a495746a7fad51851dcba8bc37c5a213, 'WECWDCWDE'),
    (4663, 0xb9338137dcc772944c4e357441d55a4bce49b49b, 'Owned reconciliation release check; review addee5f6-aea1-4ced-8b41-3d01233ec4b7'),
    (4663, 0x7570dafbde30dab0ed05c6a49330c2d2552e8a93, 'Owned 0.3% restoration release check'),
    (4663, 0xf1c780d1db22fab8124f85abd3132df4299c3f9a, 'Owned source-publication recovery check; review caba5178-61c2-4ab0-82a7-64e26b2b1f60'),
    (4663, 0xfc65fb2ad4fe188d6529ba23f8083fc34e5961b7, 'Owned Native100 release check; review 5929e544-4ee3-485d-802a-98b6270a3249'),
    (1, 0x9e7791ac645e902da1fa94451d3034e351e1aae7, 'Owned fee100 Module Mode release check; deterministic token in platform-fee100-20261012'),
    (4663, 0xb1e6e441214d3bfb7a073f8095632ab20b9d2b42, 'Owned fee-policy release check; review 2e2537d8-a5a8-49df-8ef1-43d6f54c260e'),
    (4663, 0x7e76d9b7c153fd29e87ef0b339ba44e84be5f276, 'Owned runtime-continuation release check; bound to review 36942122-37fb-4ecd-ad0c-0ddfce50d051'),
    (4663, 0x4140515cbe7bd50d4416a5950f290b76ac9c4026, 'Project technical release or reference launch 373ac34d-65b1-44e9-9b28-86bf1a908845'),
    (4663, 0xf75c25a0d60572c41f3fdcc8ae4b119c8a142164, 'Project technical release or reference launch d04ab673-abba-4b56-9f4a-f6dc9470fa1a'),
    (4663, 0x103a04145c9fa7093e639ad15183170304c42eb0, 'Project technical release or reference launch 00f3cfe2-f227-471b-993b-5045fb55968e'),
    (4663, 0x6008c81e34ec10c13897876653077d768bcacfb5, 'Project technical release or reference launch 00884d72-77ae-4910-8462-12907e2e3bcb'),
    (4663, 0xcd3a24f0e88d0d90ff5b1ce91c4ac78e7ee66b05, 'Project technical release or reference launch 0f5e87fc-c523-456f-bc06-2a165d3d280f'),
    (4663, 0x8e7667d01b670b117b84c5086d45e93eee1f715d, 'Project technical release or reference launch 0ebd7cc3-322a-4dcb-9358-9df76589166c'),
    (4663, 0x6bf4415e1155d177f9f5968f1059bf084b72b9d4, 'Project technical release or reference launch b109b6a2-0ad7-4742-b83a-4f373c6be9b8'),
    (4663, 0x64de4965ddd715fb011cebd727b1458fc820bd34, 'Project technical release or reference launch e6d3690a-8585-484d-b604-2b3ab4e20fc8'),
    (4663, 0x226d0014c0fbd6be0dfce5322102b25680db9500, 'Project technical release or reference launch 7dcd888f-ba36-4894-a35a-8dfecdb6989d'),
    (4663, 0xd5cead34df9db8537e88d9ffdf522664dee7cdac, 'Project technical release or reference launch 15d3e5fa-13bf-446d-bab3-081bf4dbabd8'),
    (4663, 0x3f4c4ab2bfecebfcab9c578b38a0311dfb56033e, 'Project technical release or reference launch 1bb21b7f-0534-4496-a914-276ef0f4d041'),
    (4663, 0x95f47fb6345edf26bf0d887afc31f57524905afc, 'Project technical release or reference launch d6a45864-1b42-4337-ae7b-b4839bf61dd8'),
    (4663, 0xca9ed02b0e26297fc85cb498937a0777f5ac0da6, 'Project technical release or reference launch 39ace269-d277-434b-a980-0aae8e75df58'),
    (4663, 0xe56bb223925e011ff5f1127c0b1f143da04f9860, 'Project technical release or reference launch 1f46ce7e-eee3-4559-b2bf-8788bcf46718'),
    (4663, 0xfa93f84c314aecd360ad8ddda623f0def086a3b5, 'Project technical release or reference launch ec874b3f-01c2-46b1-907b-de5f8ec960aa'),
    (4663, 0x7a73888170d3de8e10ebd78d4e6a685eaa92c9f4, 'Project technical release or reference launch d6f07f42-0631-4646-b9d3-e58e4525f3ad'),
    (4663, 0xc250ff0cb3004175fca0e0f32caea34f2c085650, 'Project technical release or reference launch a5481233-7ef5-4f67-96a6-699ff5783a67'),
    (4663, 0x41619a44332e85bde1df2a4d3e3bf9777212ea59, 'Project technical release or reference launch b7f89444-19ac-4fdc-bfbf-db20e4f385e6'),
    (4663, 0x34d83256b9bc41a807615899a09035b1f03f2b7a, 'Project technical release or reference launch 4c06d2b2-3638-414a-afdf-0c55e6562420'),
    (4663, 0x371eca3375d9f83ef6b2fe5166f9be8590732d86, 'Project technical release or reference launch ea43f73c-a4e0-480f-8b05-83c1c21412d2'),
    (4663, 0xe02253f8f47cdbfd88d0b75284c9ddfbab4f6778, 'Project technical release or reference launch 4ac3842a-3529-41a2-9340-ff4028dccb4a'),
    (4663, 0xd9320af2762e711918358422594684756ad760cc, 'Project technical release or reference launch 312b9b12-4fba-4147-b039-cc164fd580dc')
), module_proxies(start_block, runtime_code_hash) AS (
  VALUES
    (BIGINT '26125550', 0xbcd79a29bbf85a76fd696e196516bfd23aae5e00b56a1dc21cc3e6b2599c40cf),
    (BIGINT '26163972', 0x30eb0ae1b6114acce98f33d53a9c93d392d39cbddd2f5ed9d716f1c2b2777888),
    (BIGINT '26174610', 0xfa7455334877286ce363795881871c40626bbf4457b1f2a3cb3ae4c3b3197d00)
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
      OR topic0 IN (0x6170d19d4db2409523b652a3bf190bc7629b0a1af2e5118536ecd4b62364b099, 0xc3c5d5e4abbd15966e584a111dd56b7568327d03138a9bb801993be4c37618c1))
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
    AND c.topic0=0x8147265e7396d6400cee8d049456a1f7438fdfbe2a7c81c976d51ba67e52ff4b AND c.topic2=concat(0x000000000000000000000000,f.contract_address)
    AND varbinary_to_uint256(c.topic3)=UINT256 '0'
  JOIN module_proxies p ON c.data=p.runtime_code_hash AND c.block_number>=p.start_block
  WHERE f.chain_id=1 AND f.topic0 IN (0x6170d19d4db2409523b652a3bf190bc7629b0a1af2e5118536ecd4b62364b099, 0xc3c5d5e4abbd15966e584a111dd56b7568327d03138a9bb801993be4c37618c1)
), pool_definitions AS (
  -- An existing-token launch may use a pool created before Programmable existed.
  -- Do not apply the launch-date cutoff to pool discovery.
  SELECT 1 AS chain_id,contract_address,topic1,topic2,topic3
  FROM ethereum.logs
  WHERE contract_address=0x000000000004444c5dc75cb358380d2e3de08a90 AND topic0=0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438
    AND block_number<=(SELECT through_block FROM heads WHERE chain_id=1)
  UNION ALL
  SELECT 4663,contract_address,topic1,topic2,topic3
  FROM robinhood.logs
  WHERE contract_address=0x8366a39cc670b4001a1121b8f6a443a643e40951 AND topic0=0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438
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
    AND f.topic0=0xab930c1c165bba36257b8079ae38b6869f604910f6ffa40c956e31eb1b8ce38f)
  UNION ALL
  SELECT chain_id,token,first_block,TIMESTAMP '2026-08-01',tx_hash,'custom' FROM plan_tokens
  UNION ALL
  SELECT 4663, 0xc60ba256b44334a0cd2c7242e98b88f031abb006, BIGINT '0',
    TIMESTAMP '2026-08-01', CAST(NULL AS VARBINARY), 'main'
), identities AS (
  SELECT chain_id, token, min(first_block) AS first_block, min(first_time) AS first_time,
    min_by(category, CASE category WHEN 'main' THEN 0 WHEN 'module' THEN 1 WHEN 'custom' THEN 2 ELSE 3 END) AS category
  FROM launches l
  WHERE token<>0x0000000000000000000000000000000000000000
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
  FROM ethereum.logs WHERE contract_address=0x000000000004444c5dc75cb358380d2e3de08a90 AND topic0=0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f
    AND block_time>=TIMESTAMP '2026-07-01' AND block_number<=(SELECT through_block FROM heads WHERE chain_id=1)
  UNION ALL
  SELECT 4663,block_number,block_time,tx_hash,"index",contract_address,topic1,data
  FROM robinhood.logs WHERE contract_address=0x8366a39cc670b4001a1121b8f6a443a643e40951 AND topic0=0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f
    AND block_time>=TIMESTAMP '2026-08-01' AND block_number<=(SELECT through_block FROM heads WHERE chain_id=4663)
), raw_v4 AS (
  SELECT l.chain_id,l.block_number,l.block_time,l.tx_hash,l.log_index,p.category,p.currency0,p.currency1,
    abs(CAST(varbinary_to_int256(varbinary_substring(l.data,1,32)) AS DOUBLE)) AS amount0_raw,
    abs(CAST(varbinary_to_int256(varbinary_substring(l.data,33,32)) AS DOUBLE)) AS amount1_raw,
    CASE WHEN p.currency0=0x0000000000000000000000000000000000000000 OR (l.chain_id=4663 AND p.currency0=0x0bd7d308f8e1639fab988df18a8011f41eacad73) THEN 'ethereum'
      WHEN l.chain_id=1 THEN 'ethereum' ELSE 'robinhood' END AS price_chain0,
    CASE WHEN p.currency1=0x0000000000000000000000000000000000000000 OR (l.chain_id=4663 AND p.currency1=0x0bd7d308f8e1639fab988df18a8011f41eacad73) THEN 'ethereum'
      WHEN l.chain_id=1 THEN 'ethereum' ELSE 'robinhood' END AS price_chain1,
    CASE WHEN p.currency0=0x0000000000000000000000000000000000000000 OR (l.chain_id=4663 AND p.currency0=0x0bd7d308f8e1639fab988df18a8011f41eacad73) THEN 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2 ELSE p.currency0 END AS price_asset0,
    CASE WHEN p.currency1=0x0000000000000000000000000000000000000000 OR (l.chain_id=4663 AND p.currency1=0x0bd7d308f8e1639fab988df18a8011f41eacad73) THEN 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2 ELSE p.currency1 END AS price_asset1
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
    CASE WHEN price_asset0=0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2 THEN coalesce(usd0,usd1)
      WHEN price_asset1=0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2 THEN coalesce(usd1,usd0)
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
