import React from "react";
import {createRoot} from "react-dom/client";
import {EvmCustomSwap} from "../../../components/evm-custom-swap";
createRoot(document.getElementById("root")!).render(<main><EvmCustomSwap token="0x1111111111111111111111111111111111111111" symbol="HYPETEST"/></main>);
