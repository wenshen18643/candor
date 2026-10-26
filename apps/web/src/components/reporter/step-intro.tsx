"use client";

import { ChevronDown, EyeOff, FileLock2, ScanFace, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useReporter } from "@/lib/reporter/store";
import type { CampaignInfo } from "@/lib/reporter/types";

import { StepActions, StepHeading } from "./parts";

export function StepIntro({ campaign }: { campaign: CampaignInfo }) {
  const setStep = useReporter((state) => state.setStep);
  const promises = [
    {
      icon: ScanFace,
      title: "We never learn who you are",
      body: "You prove you are allowed to report with the Self app. Candor gets a yes or no. It never sees your name, photo or passport number.",
    },
    {
      icon: EyeOff,
      title: "Your files are cleaned on this device",
      body: "Hidden details like author names, edit history and email headers are removed, and you choose which names to hide, before anything leaves this browser.",
    },
    {
      icon: Users,
      title: `It takes ${campaign.threshold} of ${campaign.reviewers.length} reviewers to open your files`,
      body: `Your files are locked with a key split between the ${campaign.orgName} ethics panel. No single person can open them. Neither can Candor.`,
    },
    {
      icon: FileLock2,
      title: "You get a private way to talk",
      body: "You will get eight secret words. Use them to read questions from reviewers and answer them, without giving your name.",
    },
  ];

  return (
    <section aria-labelledby="intro-title">
      <StepHeading title={<span id="intro-title">Report what happened at {campaign.orgName}</span>}>
        <p>{campaign.description}</p>
      </StepHeading>

      <ul className="flex flex-col gap-5">
        {promises.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.title} className="flex gap-4">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-seal-soft text-seal-ink">
                <Icon className="size-4.5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-md font-semibold">{item.title}</h2>
                <p className="mt-1 max-w-[60ch] text-base leading-6 text-ink-2">{item.body}</p>
              </div>
            </li>
          );
        })}
      </ul>

      <details className="group mt-8 rounded-lg border border-line bg-surface">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-base font-medium [&::-webkit-details-marker]:hidden">
          Stay safe while you report
          <ChevronDown
            className="size-4 text-ink-3 transition-transform duration-200 group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <ul className="flex list-disc flex-col gap-2 border-t border-line px-4 py-4 pl-9 text-base leading-6 text-ink-2">
          <li>Use your own phone or computer, not a work device.</li>
          <li>Don&apos;t use work Wi-Fi or a work VPN. Mobile data is safer.</li>
          <li>For the strongest protection, open this page in Tor Browser.</li>
          <li>
            Don&apos;t tell coworkers you are reporting, and don&apos;t forward files from your work
            email.
          </li>
          <li>
            Need to close this page fast? Press <strong className="text-ink">Leave quickly</strong>{" "}
            at the top. It replaces this page in your history.
          </li>
        </ul>
      </details>

      <StepActions>
        <p className="text-sm text-ink-2">
          Takes about 5 minutes. Nothing is sent until the last step.
        </p>
        <Button variant="primary" size="lg" onClick={() => setStep("verify")}>
          Start
        </Button>
      </StepActions>
    </section>
  );
}
