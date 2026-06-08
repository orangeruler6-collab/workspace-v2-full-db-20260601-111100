"use client";

import { LibraryProvider } from "./LibraryProvider";
import { TaskProvider } from "./TaskProvider";
import { FeedbackProvider } from "./FeedbackProvider";
import { HostThemeBridge } from "./HostThemeBridge";
import { HostActiveProvider } from "./HostActiveProvider";
import { HostAuthProvider } from "./HostAuthProvider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <HostAuthProvider>
      <HostActiveProvider>
        <LibraryProvider>
          <FeedbackProvider>
            <TaskProvider>
              <HostThemeBridge />
              {children}
            </TaskProvider>
          </FeedbackProvider>
        </LibraryProvider>
      </HostActiveProvider>
    </HostAuthProvider>
  );
}
