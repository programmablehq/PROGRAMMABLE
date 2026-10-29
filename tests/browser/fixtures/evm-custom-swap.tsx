import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import {EvmCustomSwap} from "../../../components/evm-custom-swap";
function Fixture() {
  const [changed, setChanged] = useState(false);
  return <main><EvmCustomSwap token={changed ? "0x4444444444444444444444444444444444444444" : "0x1111111111111111111111111111111111111111"} symbol={changed ? "NEXTTEST" : "HYPETEST"}/>
  <button type="button" onClick={() => setChanged(true)}>Switch token</button></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
