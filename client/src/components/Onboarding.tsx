import { useState } from "react";
import type { Connection } from "../connection";
import { parsePairingCode, saveConnection, testConnection } from "../connection";
import { AppIcon } from "./AppIcon";

interface OnboardingProps {
  onConnected: (connection: Connection) => void;
}

export function Onboarding({ onConnected }: OnboardingProps) {
  const [step, setStep] = useState<"welcome" | "pair">("welcome");
  const [code, setCode] = useState("");
  const [manual, setManual] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setError(null);
    setBusy(true);
    try {
      const target = manual
        ? { url: url.trim().replace(/\/+$/, ""), token: token.trim() }
        : parsePairingCode(code);
      if (!target.url || !target.token) {
        throw new Error("Enter the server address and token.");
      }
      await testConnection(target.url, target.token);
      const connection: Connection = { mode: "remote", ...target };
      saveConnection(connection);
      onConnected(connection);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed.");
    } finally {
      setBusy(false);
    }
  }

  function startDemo() {
    const connection: Connection = { mode: "demo" };
    saveConnection(connection);
    onConnected(connection);
  }

  if (step === "welcome") {
    return (
      <div className="onboarding">
        <div className="onboarding-step" key="welcome">
          <AppIcon size={100} />
          <h1 className="onboarding-title">Welcome to RyMessage</h1>
          <p className="onboarding-sub">
            All of your iMessage conversations, right here on Windows.
            <br />
            Your Mac does the talking.
          </p>
          <div className="onboarding-actions">
            <button className="primary-button" onClick={() => setStep("pair")}>
              Continue
            </button>
            <button className="link-button" onClick={startDemo}>
              Try the Demo
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="onboarding">
      <div className="onboarding-step" key="pair">
        <AppIcon size={64} />
        <h1 className="onboarding-title onboarding-title-small">Connect to Your Mac</h1>
        <p className="onboarding-sub">
          Start the RyMessage server on your Mac, then
          {manual ? " enter its address and token below." : " paste the pairing code it prints below."}
        </p>
        {manual ? (
          <div className="onboarding-fields">
            <input
              className="onboarding-input"
              type="text"
              placeholder="Server address, e.g. http://192.168.1.20:8787"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
            />
            <input
              className="onboarding-input"
              type="password"
              placeholder="Token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={busy}
            />
          </div>
        ) : (
          <textarea
            className="onboarding-input onboarding-code"
            placeholder="RYM1.…"
            rows={3}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={busy}
            spellCheck={false}
          />
        )}
        <p className={`onboarding-error ${error ? "visible" : ""}`}>{error ?? "\u00a0"}</p>
        <div className="onboarding-actions">
          <button className="primary-button" onClick={connect} disabled={busy}>
            {busy ? "Connecting…" : "Connect"}
          </button>
          <div className="onboarding-links">
            <button
              className="link-button"
              onClick={() => {
                setStep("welcome");
                setError(null);
              }}
              disabled={busy}
            >
              Back
            </button>
            <button
              className="link-button"
              onClick={() => {
                setManual(!manual);
                setError(null);
              }}
              disabled={busy}
            >
              {manual ? "Use a Pairing Code" : "Enter Address Manually"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
