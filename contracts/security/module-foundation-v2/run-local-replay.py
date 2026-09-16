#!/usr/bin/env python3
"""Run the committed Foundation suites against a hash-bound local genesis; no public RPC or signing."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import time
import urllib.request


CONTRACTS = Path(__file__).resolve().parents[2]
# Fresh local Foundry test executor, so CREATE does not collide with the original exported test executor.
# This is a test-only EVM identity, never a real wallet or production deployment sender.
TEST_EXECUTOR = "0x0000000000000000000000000000000046563201"
PINS = {
    "v4-core": "59d3ecf53afa9264a16bba0e38f4c5d2231f80bc",
    "v4-periphery": "ad04c9f24a170accf5ea1b2836bbafd514537ca6",
    "v4-periphery-v211": "3231810e39b8c4d569b9d66907fa4ef8cd2cec22",
    "universal-router": "999d561c3ad58fb5cab91b602911f3c75591a9c7",
    "openzeppelin-contracts": "21c8312b022f495ebe3621d5daeed20552b43ff9",
    "openzeppelin-uniswap-hooks": "26dc8e53f812a1ca390d470342adb6cd8c3286ad",
    "permit2": "cc56ad0f3439c502c246fc5cfcc3db92bb8b7219",
    "forge-std": "3b20d60d14b343ee4f908cb8079495c07f5e8981",
    "solmate": "4b47a19038b798b4a33d9749d25e570443520647",
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tracked_inputs():
    paths = [CONTRACTS / "foundry.toml", CONTRACTS / "remappings.txt", Path(__file__).resolve()]
    for directory in ("src/module-foundation", "test/module-foundation"):
        paths.extend(sorted((CONTRACTS / directory).glob("*.sol")))
    return {str(path.relative_to(CONTRACTS)): digest(path) for path in paths}


def verify_pins():
    for name, expected in PINS.items():
        directory = CONTRACTS / "lib" / name
        actual = subprocess.check_output(["git", "-C", str(directory), "rev-parse", "HEAD"], text=True).strip()
        changed = subprocess.check_output(
            ["git", "-C", str(directory), "status", "--porcelain", "--untracked-files=no"], text=True
        ).strip()
        if actual != expected or changed:
            raise RuntimeError(f"Dependency pin or tracked bytes differ: {name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--genesis", type=Path, required=True)
    parser.add_argument("--genesis-sha256", required=True)
    parser.add_argument("--forge", type=Path, required=True)
    parser.add_argument("--anvil", type=Path, required=True)
    parser.add_argument("--solc", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True, help="New directory under contracts/out only")
    parser.add_argument("--port", type=int, default=18549)
    args = parser.parse_args()
    genesis = args.genesis.resolve(strict=True)
    if digest(genesis) != args.genesis_sha256:
        raise RuntimeError("Genesis SHA256 does not match the explicit expected bytes")
    state = json.loads(genesis.read_text())
    if state.get("config", {}).get("chainId") != 4663 or not state.get("alloc"):
        raise RuntimeError("Expected the genuine exported chain-4663 fixture allocations")
    output = args.output.resolve()
    if not output.is_relative_to(CONTRACTS / "out") or output.exists():
        raise RuntimeError("Evidence output must be a new directory under contracts/out")
    if not 1024 <= args.port <= 65535:
        raise RuntimeError("Local port is out of range")
    verify_pins()
    source_hashes = tracked_inputs()
    binaries = {name: getattr(args, name).resolve(strict=True) for name in ("forge", "anvil", "solc")}
    versions = {name: subprocess.check_output([str(binary), "--version"], text=True).strip() for name, binary in binaries.items()}
    if "0.8.26+commit.8a97fa7a" not in versions["solc"] or "1.7.1" not in versions["forge"]:
        raise RuntimeError("Expected source-bound Solidity 0.8.26 and Forge 1.7.1")
    with socket.socket() as check:
        if check.connect_ex(("127.0.0.1", args.port)) == 0:
            raise RuntimeError("Local port already occupied; no existing process will be replaced")
    output.mkdir(parents=True)
    local_url = f"http://127.0.0.1:{args.port}"

    def header():
        request = urllib.request.Request(
            local_url,
            data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_getBlockByNumber", "params": ["latest", False]}).encode(),
            headers={"content-type": "application/json"},
        )
        # Explicitly avoid ambient proxy configuration for the private loopback process.
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=3) as response:
            value = json.load(response)
        if "error" in value:
            raise RuntimeError("Local header read failed")
        return value["result"]

    with (output / "anvil.log").open("w") as anvil_log:
        process = subprocess.Popen([
            str(binaries["anvil"]), "--init", str(genesis), "--chain-id", "4663", "--hardfork", "cancun",
            "--gas-limit", "50000000", "--no-mining", "--accounts", "0", "--host", "127.0.0.1",
            "--port", str(args.port), "--quiet",
        ], cwd=CONTRACTS, stdout=anvil_log, stderr=subprocess.STDOUT)
        try:
            for _ in range(100):
                if process.poll() is not None:
                    raise RuntimeError("Local Anvil exited during startup")
                try:
                    before = header()
                    break
                except OSError:
                    time.sleep(0.1)
            else:
                raise RuntimeError("Local Anvil startup timeout")
            if before["number"] != "0x0" or before["transactions"]:
                raise RuntimeError("Local replay must start at genesis without transactions")
            environment = {key: value for key, value in os.environ.items() if not key.startswith("FOUNDRY_")}
            environment.update(FOUNDRY_PROFILE="module-foundation", FOUNDATION_RPC_URL=local_url, FOUNDATION_FORK_BLOCK="0")
            command = [str(binaries["forge"]), "test", "--offline", "--use", str(binaries["solc"]), "--sender", TEST_EXECUTOR,
                       "--match-path", "test/module-foundation/*.t.sol", "-vvv"]
            started = time.monotonic()
            with (output / "forge.log").open("w") as log:
                completed = subprocess.run(command, cwd=CONTRACTS, env=environment, stdout=log, stderr=subprocess.STDOUT)
            elapsed = time.monotonic() - started
            after = header()
            if after != before:
                raise RuntimeError("Persistent local genesis changed during Foundry execution")
            if digest(genesis) != args.genesis_sha256 or tracked_inputs() != source_hashes:
                raise RuntimeError("Source or original genesis bytes changed during replay")
            verify_pins()
            log = (output / "forge.log").read_text()
            summaries = re.findall(r"(\d+) tests? passed, (\d+) failed, (\d+) skipped", log)
            counts = tuple(map(int, summaries[-1])) if summaries else (0, 1, 0)
            result = {
                "status": "PASS" if completed.returncode == 0 and counts[0] > 0 and counts[1:] == (0, 0) else "FAIL",
                "evidenceKind": "local-EVM-replay-of-recorded-official-runtime-fixture",
                "publicRPC": False, "broadcast": False, "finality": "not-assessed",
                "localTestExecutor": TEST_EXECUTOR,
                "genesisSHA256": args.genesis_sha256, "persistentHeaderBefore": before, "persistentHeaderAfter": after,
                "dependencies": PINS, "trackedDependencyBytesUnchanged": True, "sourceSHA256": source_hashes,
                "toolchain": {name: {"version": versions[name], "sha256": digest(binary)} for name, binary in binaries.items()},
                "forgeExitCode": completed.returncode, "passed": counts[0], "failed": counts[1], "skipped": counts[2],
                "elapsedSeconds": round(elapsed, 3), "forgeLogSHA256": digest(output / "forge.log"),
            }
            (output / "result.json").write_text(json.dumps(result, indent=2) + "\n")
            print(json.dumps({key: result[key] for key in ("status", "passed", "failed", "skipped", "elapsedSeconds")}))
            if result["status"] != "PASS":
                raise RuntimeError("Foundation replay failed; preserved forge.log contains the exact failures")
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


if __name__ == "__main__":
    main()
