#!/usr/bin/env python3
"""Export self-contained explorer input, after reproducing the local core bytecode.

No RPC, wallet, API token, upload or deployment. Run after the focused Forge build.
The caller supplies the installed, exact solc binary; no compiler is downloaded.
"""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import tempfile


CONTRACTS = (
    "CustomAIFactoryV1", "CustomAITokenV1", "CustomAIHookV1",
    "CustomAIHookDeployerV1", "CustomAILiquidityDeployerV1",
    "CustomAILiquidityVaultV1", "CustomAISwapRouterV1", "CustomAIFeeLedgerV1",
    "CustomAIRewardVaultV1", "CustomAIDataFeedV1", "CustomAIThresholdFeeModuleV1",
)


def encoded(value):
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def bytecode(value):
    return bytes.fromhex(value.removeprefix("0x"))


def canonical_abi(abi):
    # ABI entry order is insignificant; parameter/component order is not.
    return sorted(json.dumps(entry, sort_keys=True) for entry in abi)


def build_packet(root, solc):
    artifacts, sources, hashes = {}, {}, {}
    settings = compiler = None
    for name in CONTRACTS:
        artifact_path = root / "out/custom-ai" / (name + ".sol") / (name + ".json")
        artifact = json.loads(artifact_path.read_text())
        metadata = artifact["metadata"]
        current = dict(metadata["settings"])
        target = current.pop("compilationTarget")
        if target != {f"src/custom-ai/{name}.sol": name}:
            raise ValueError(f"Unexpected compilation target: {name}")
        version = metadata["compiler"]["version"]
        if settings is not None and (settings != current or compiler != version):
            raise ValueError(f"Mixed compiler configuration: {name}")
        settings, compiler = current, version
        artifacts[name] = artifact
        for path in metadata["sources"]:
            relative = PurePosixPath(path)
            if relative.is_absolute() or ".." in relative.parts or relative.suffix != ".sol":
                raise ValueError(f"Unexpected source path: {path}")
            if not (path.startswith("src/custom-ai/") or path.startswith("lib/")):
                raise ValueError(f"Non-core source: {path}")
            source_path = root / path
            allowed_root = root / ("lib" if path.startswith("lib/") else "src/custom-ai")
            if not source_path.resolve().is_relative_to(allowed_root.resolve()):
                raise ValueError(f"Source escapes its root: {path}")
            content = source_path.read_bytes()
            sources[path] = {"content": content.decode("utf-8")}
            hashes[path] = sha256(content)

    version_output = subprocess.run([solc, "--version"], check=True, capture_output=True, text=True).stdout
    if f"Version: {compiler}" not in version_output:
        raise ValueError(f"Requires exact compiler {compiler}")
    settings["outputSelection"] = {
        f"src/custom-ai/{name}.sol": {name: ["abi", "evm.bytecode", "evm.deployedBytecode", "evm.methodIdentifiers"]}
        for name in CONTRACTS
    }
    standard_input = {"language": "Solidity", "sources": sources, "settings": settings}
    source_bytes = encoded(standard_input)
    # An empty working directory ensures there is no accidental source fallback.
    with tempfile.TemporaryDirectory(prefix="custom-ai-solc-") as empty_dir:
        process = subprocess.run(
            [solc, "--standard-json"], input=source_bytes, capture_output=True,
            cwd=empty_dir, check=True, timeout=600,
        )
    result = json.loads(process.stdout)
    errors = [e["formattedMessage"] for e in result.get("errors", []) if e["severity"] == "error"]
    if errors:
        raise ValueError("Standalone compilation failed:\n" + "\n".join(errors))
    targets = {}
    for name, artifact in artifacts.items():
        path = f"src/custom-ai/{name}.sol"
        rebuilt = result["contracts"][path][name]
        for artifact_key, compiler_key in (("bytecode", "bytecode"), ("deployedBytecode", "deployedBytecode")):
            if bytecode(artifact[artifact_key]["object"]) != bytecode(rebuilt["evm"][compiler_key]["object"]):
                raise ValueError(f"Bytecode mismatch for {name}/{artifact_key}; rebuild and retest first")
        if canonical_abi(artifact["abi"]) != canonical_abi(rebuilt["abi"]) or artifact["methodIdentifiers"] != rebuilt["evm"]["methodIdentifiers"]:
            raise ValueError(f"ABI mismatch for {name}")
        creation = bytecode(artifact["bytecode"]["object"])
        runtime = bytecode(artifact["deployedBytecode"]["object"])
        targets[name] = {
            "contractName": f"{path}:{name}",
            "creationTemplateBytes": len(creation), "creationTemplateSha256": sha256(creation),
            "runtimeTemplateBytes": len(runtime), "runtimeTemplateSha256": sha256(runtime),
            "immutableReferences": rebuilt["evm"]["deployedBytecode"]["immutableReferences"],
            "constructor": next((x for x in rebuilt["abi"] if x["type"] == "constructor"), None),
            "externalFunctions": rebuilt["evm"]["methodIdentifiers"],
            "nonViewFunctions": [
                x for x in rebuilt["abi"]
                if x["type"] == "function" and x["stateMutability"] not in ("view", "pure")
            ],
        }
    manifest = {
        "schemaVersion": 1,
        "status": "local-bytecode-reproduced",
        "compilerVersion": "v" + compiler,
        "codeFormat": "solidity-standard-json-input",
        "standardInputSha256": sha256(source_bytes),
        "sourceSha256": hashes,
        "targets": targets,
        "onchainVerification": None,
        "scannerVerdicts": None,
        "independentAudit": False,
        "deploymentRequirements": [
            "Record chain, address, creation transaction and exact ABI constructor arguments for every instance.",
            "Compare finalized deployed bytecode including immutable values with this build and constructor inputs.",
            "Submit standard-input.json and each fully qualified target to the chain explorer; poll the verification result.",
            "Verify generated modules, data feeds, quote token and official PoolManager/router dependencies separately.",
            "Record actual provider responses with timestamps and chain/token/pool binding; absent verdicts are unknown.",
        ],
    }
    return source_bytes, encoded(manifest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--solc", required=True, help="Path to the installed exact compiler")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent / "verification-bundle")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    source_bytes, manifest_bytes = build_packet(root, str(Path(args.solc).resolve()))
    args.output.mkdir(parents=True, exist_ok=True)
    for name, value in (("standard-input.json", source_bytes), ("manifest.json", manifest_bytes)):
        temporary = args.output / (name + ".tmp")
        temporary.write_bytes(value)
        temporary.replace(args.output / name)
    print(json.dumps({"reproducedContracts": len(CONTRACTS), "bundle": str(args.output), "deployed": False}))


if __name__ == "__main__":
    main()
