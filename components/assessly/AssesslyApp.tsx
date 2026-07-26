"use client";

import { C } from "./theme";
import { IconCheck } from "./icons";
import { AssesslyProvider, useAssessly } from "./store";
import { Login } from "./Login";
import { SetPassword } from "./SetPassword";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { Dashboard, Finalised, Generated, Ongoing } from "./screens/Pipeline";
import { FinalisedRun } from "./screens/FinalisedRun";
import { Banks, BankDetail } from "./screens/Banks";
import { Review } from "./screens/Review";
import { Scratch } from "./screens/Scratch";
import { TagScreen } from "./Tags";
import { GenerateModal } from "./GenerateModal";

export function AssesslyApp() {
  return (
    <AssesslyProvider>
      <Shell />
    </AssesslyProvider>
  );
}

function Shell() {
  const { loggedIn, authReady, screen, user } = useAssessly();

  if (!authReady) {
    return <div className="assessly-root" style={{ display: "flex", alignItems: "center", justifyContent: "center" }} />;
  }

  if (!loggedIn) {
    return (
      <div className="assessly-root">
        <Login />
        <Toast />
      </div>
    );
  }

  // Signed in but still on the shared bootstrap password: force a private one
  // before anything else in the workspace is reachable.
  if (user?.mustReset) {
    return (
      <div className="assessly-root">
        <SetPassword />
        <Toast />
      </div>
    );
  }

  return (
    <div className="assessly-root">
      <div style={{ height: "100vh", display: "flex" }}>
        <Sidebar />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <Topbar />
          <main style={{ flex: 1, overflowY: "auto", padding: "34px 40px" }}>
            {screen === "dashboard" && <Dashboard />}
            {screen === "ongoing" && <Ongoing />}
            {screen === "generated" && <Generated />}
            {screen === "finalised" && <Finalised />}
            {screen === "finalisedRun" && <FinalisedRun />}
            {screen === "banks" && <Banks />}
            {screen === "bank" && <BankDetail />}
            {screen === "review" && <Review />}
            {screen === "tag" && <TagScreen />}
            {/* deep link /create → dashboard behind the wizard modal */}
            {screen === "scratch" && <Dashboard />}
          </main>
        </div>
      </div>
      <GenerateModal />
      <Scratch />
      <Toast />
    </div>
  );
}

function Toast() {
  const { toastMsg } = useAssessly();
  if (!toastMsg) return null;
  return (
    <div style={{ position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)", background: C.navy, color: "#fff", padding: "13px 20px", borderRadius: 12, fontSize: 13.5, fontWeight: 600, boxShadow: "0 12px 30px rgba(22,36,61,.3)", display: "flex", alignItems: "center", gap: 10, zIndex: 200 }}>
      <span style={{ width: 20, height: 20, borderRadius: "50%", background: C.green, display: "flex", alignItems: "center", justifyContent: "center" }}><IconCheck s={12} stroke="#fff" sw={2.4} /></span>
      {toastMsg}
    </div>
  );
}
