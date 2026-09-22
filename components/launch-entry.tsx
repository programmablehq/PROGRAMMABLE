"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Clock3, Puzzle } from "lucide-react";

import launchExperience from "@/components/launch-experience.module.css";
import { useViewChain, type ViewChainId } from "@/components/view-chain";
import { resolveImplementedLaunchModel } from "@/lib/launch-model-gating";
import type { LaunchModel } from "@/lib/launch";
import { DEFAULT_VIEW_CHAIN_ID } from "@/lib/view-chain";

const classicV3LaunchAvailable = false;

function loadLaunchForm() {
  return import("@/components/launch-builder");
}

type LaunchBuilderComponent =
  (typeof import("@/components/launch-builder"))["LaunchBuilderForm"];
type LaunchPickerChoice = LaunchModel;

function LaunchArtworkImage() {
  const [ready, setReady] = useState(false);
  return (
    <Image
      className={launchExperience.artImage}
      src="/brand/atmosphere/programmable-floral-hooks-v1.webp"
      alt=""
      fill
      sizes="(max-width: 760px) calc(100vw - 32px), (max-width: 1280px) calc((100vw - 96px) / 2), 624px"
      priority
      data-ready={ready}
      onLoad={() => setReady(true)}
    />
  );
}

/** Opening a draft is always available; the builder checks authority before review and submission. */
export function ModuleFoundationLaunchCard() {
  const cardProps = {
    className: `launch-model-card ${launchExperience.modelCard} liquid-glass-surface`,
    "data-launch-model-option": "modules",
    "data-launch-model-entry": "foundation",
    "data-launch-model-launchable": "false",
    "aria-labelledby": "launch-model-modules-title",
    "aria-describedby": "launch-model-modules-description launch-model-modules-status",
  };
  const content = <>
    <span className={`${launchExperience.modelArt} ${launchExperience.moduleArt}`} aria-hidden="true">
      <Puzzle className={launchExperience.modulePuzzle} strokeWidth={0.7} />
    </span>
    <span className={`launch-model-card-body ${launchExperience.modelBody}`}>
      <span className={`launch-model-card-heading ${launchExperience.modelHeading}`}>
        <strong id="launch-model-modules-title">Module Mode</strong>
      </span>
      <span className={`launch-model-description ${launchExperience.modelDescription}`} id="launch-model-modules-description">
        Create a coin and choose its modules at launch.
      </span>
      <span className={launchExperience.modelAction} id="launch-model-modules-status">
        Launch a coin<ArrowRight aria-hidden="true" size={16} />
      </span>
    </span>
  </>;
  return <Link {...cardProps} href="/launch/modules/foundation">{content}</Link>;
}

export function LaunchExperience({
  initialViewChainId = DEFAULT_VIEW_CHAIN_ID,
}: Readonly<{ initialViewChainId?: ViewChainId }>) {
  const { hydrated, viewChainId, setViewChainId } = useViewChain();
  return (
    <LaunchExperienceRuntime
      chainId={hydrated ? viewChainId : initialViewChainId}
      onChangeChain={setViewChainId}
    />
  );
}

function LaunchExperienceRuntime({
  chainId,
  onChangeChain,
}: Readonly<{
  chainId: ViewChainId;
  onChangeChain: (chainId: ViewChainId) => void;
}>) {
  const [selectedModel, setSelectedModel] = useState<LaunchPickerChoice | null>(null);
  const [loadedLaunchBuilder, setLoadedLaunchBuilder] =
    useState<LaunchBuilderComponent | null>(null);
  const [preparingModel, setPreparingModel] = useState<LaunchModel | null>(null);
  const [modelLoadError, setModelLoadError] = useState("");

  useEffect(() => {
    if (chainId !== 1 || !classicV3LaunchAvailable) return;
    void loadLaunchForm().catch(() => undefined);
  }, [chainId]);

  async function chooseModel(candidate: LaunchPickerChoice) {
    const model = resolveImplementedLaunchModel(candidate);
    if (
      chainId !== 1 ||
      !model ||
      model === "deep" ||
      model === "stock-paired" ||
      (model === "classic-v3" && !classicV3LaunchAvailable)
    ) {
      return;
    }

    setPreparingModel(model);
    setModelLoadError("");

    try {
      const launchModule = await loadLaunchForm();
      setLoadedLaunchBuilder(() => launchModule.LaunchBuilderForm);
      window.scrollTo({ left: 0, top: 0, behavior: "auto" });
      setSelectedModel(model);
    } catch {
      setModelLoadError("Classic could not open. Try again.");
    } finally {
      setPreparingModel(null);
    }
  }

  function returnToModels() {
    window.scrollTo({ left: 0, top: 0, behavior: "auto" });
    setSelectedModel(null);
  }

  if (!selectedModel || chainId !== 1) {
    return (
      <LaunchModelPicker
        chainId={chainId}
        onChangeChain={(nextChainId) => {
          setSelectedModel(null);
          setModelLoadError("");
          onChangeChain(nextChainId);
        }}
        modelLoadError={modelLoadError}
        onChoose={chooseModel}
        preparingModel={preparingModel}
      />
    );
  }

  if (!loadedLaunchBuilder) return null;

  const LoadedLaunchBuilder = loadedLaunchBuilder;
  return (
    <LoadedLaunchBuilder
      model={selectedModel}
      onBackToModels={returnToModels}
      stockPairedPublicLaunchEnabled={false}
    />
  );
}

export function LaunchModelPicker({
  chainId = DEFAULT_VIEW_CHAIN_ID,
  modelLoadError = "",
  onChoose,
  preparingModel = null,
}: {
  chainId?: ViewChainId;
  onChangeChain?: (chainId: ViewChainId) => void;
  modelLoadError?: string;
  onChoose: (model: LaunchPickerChoice) => void | Promise<void>;
  preparingModel?: LaunchModel | null;
}) {
  const isEthereum = chainId === 1;
  const preloadAvailableForm = () => {
    void loadLaunchForm().catch(() => undefined);
  };

  const customCardContent = (
    <>
      <span
        className={`launch-model-art ${launchExperience.modelArt} ${launchExperience.customArt}`}
        aria-hidden="true"
      >
        <LaunchArtworkImage />
        <Image
          className={`${launchExperience.classicLogo} ${launchExperience.customLogo}`}
          src="/brand/loop/programmable-loop-mark-warm-ivory-v1-1536.png"
          alt=""
          width={1536}
          height={1536}
          sizes="128px"
        />
      </span>
      <span
        className={`launch-model-card-body ${launchExperience.modelBody}`}
      >
        <span
          className={`launch-model-card-heading ${launchExperience.modelHeading}`}
        >
          <strong id="launch-model-custom-title">Custom hook</strong>
        </span>
        <span
          className={`launch-model-description ${launchExperience.modelDescription}`}
          id="launch-model-custom-description"
        >
          Create a Uniswap v4 hook with your own logic.
        </span>
        <span
          className={launchExperience.modelAction}
          id="launch-model-custom-status"
        >
          Launch a hook<ArrowRight aria-hidden="true" size={16} />
        </span>
      </span>
    </>
  );

  return (
    <div
      className={`launch-model-page page-width ${launchExperience.pickerPage}`}
    >
      <header
        className={`launch-model-heading ${launchExperience.pickerHeading}`}
      >
        <h1 className="sr-only">Launch</h1>
      </header>

      <div
        key={chainId}
        className={`launch-model-grid ${launchExperience.modelGrid}`}
      >
        {isEthereum ? (
          <button
            className={`launch-model-card ${launchExperience.modelCard} liquid-glass-surface`}
            data-launch-model-option="classic"
            data-launch-model-available={classicV3LaunchAvailable}
            data-launch-model-launchable={classicV3LaunchAvailable}
            type="button"
            disabled={!classicV3LaunchAvailable || preparingModel !== null}
            aria-busy={preparingModel === "classic-v3"}
            aria-labelledby="launch-model-classic-title"
            aria-describedby={classicV3LaunchAvailable ? "launch-model-classic-description" : "launch-model-classic-description launch-model-classic-status"}
            onPointerEnter={
              classicV3LaunchAvailable ? preloadAvailableForm : undefined
            }
            onPointerDown={
              classicV3LaunchAvailable ? preloadAvailableForm : undefined
            }
            onFocus={classicV3LaunchAvailable ? preloadAvailableForm : undefined}
            onClick={() => void onChoose("classic-v3")}
          >
            <span
              className={`launch-model-art launch-model-art-classic ${launchExperience.modelArt} ${launchExperience.classicArt}`}
              aria-hidden="true"
            >
              <LaunchArtworkImage />
              <Image
                className={launchExperience.classicLogo}
                src="/brand/loop/programmable-loop-mark-warm-ivory-v1-1536.png"
                alt=""
                width={1536}
                height={1536}
                sizes="128px"
              />
            </span>

            <span
              className={`launch-model-card-body ${launchExperience.modelBody}`}
            >
              <span
                className={`launch-model-card-heading ${launchExperience.modelHeading}`}
              >
                <strong id="launch-model-classic-title">Classic</strong>
              </span>
              <span
                className={`launch-model-description ${launchExperience.modelDescription}`}
                id="launch-model-classic-description"
              >
                Create a fixed-supply token with locked liquidity and optional
                trading fees.
              </span>
              {!classicV3LaunchAvailable ? (
                <span className={launchExperience.maintenanceStatus} id="launch-model-classic-status">
                  <Clock3 aria-hidden="true" size={14} />
                  Getting updated currently
                </span>
              ) : (
                <span
                  className={`launch-model-action ${launchExperience.modelAction}`}
                >
                  {preparingModel === "classic-v3"
                    ? "Opening Classic"
                    : "Create a coin"}
                  <ArrowRight aria-hidden="true" size={16} />
                </span>
              )}
            </span>
          </button>
        ) : (
          <ModuleFoundationLaunchCard />
        )}

        <Link
          className={`launch-model-card ${launchExperience.modelCard} liquid-glass-surface`}
          data-launch-model-option="custom"
          data-launch-model-available="true"
          data-launch-model-entry="developer-launch"
          data-launch-model-launchable="false"
          href="/developers/api-keys?start=custom&chainId=4663"
          aria-labelledby="launch-model-custom-title"
          aria-describedby="launch-model-custom-description launch-model-custom-status"
        >
          {customCardContent}
        </Link>

      </div>
      {modelLoadError ? (
        <p className={launchExperience.modelLoadError} role="alert">
          {modelLoadError}
        </p>
      ) : null}
    </div>
  );
}
