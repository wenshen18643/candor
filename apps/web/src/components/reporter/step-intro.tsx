"use client";

import { EyeOff, FileLock2, ScanFace, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useReporter } from "@/lib/reporter/store";
import type { CampaignInfo } from "@/lib/reporter/types";

import { Disclosure, StepActions, StepHeading } from "./parts";

export function StepIntro({ campaign }: { campaign: CampaignInfo }) {
  const setStep = useReporter((state) => state.setStep);
  const promises = [
    {
      icon: ScanFace,
      title: "We never learn who you are",
      body: "A passport check says yes or no. No name, photo or number.",
    },
    {
      icon: EyeOff,
      title: "Files are cleaned here first",
      body: "Names and hidden details are removed before anything is sent.",
    },
    {
      icon: Users,
      title: `${campaign.threshold} of ${campaign.reviewers.length} reviewers needed to open them`,
      body: "No single person can open your files. Neither can Candor.",
    },
    {
      icon: FileLock2,
      title: "Talk back privately",
      body: "Eight secret words let you read and answer questions.",
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
                <p className="mt-0.5 text-base leading-6 text-ink-2">{item.body}</p>
              </div>
            </li>
          );
        })}
      </ul>

      <Disclosure summary="Stay safe while you report" className="mt-8">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-base leading-6 text-ink-2">
          <li>Use your own device, not a work one.</li>
          <li>Avoid work Wi-Fi. Mobile data is safer.</li>
          <li>For the most protection, use Tor Browser.</li>
          <li>
            Need to hide this fast? Press <strong className="text-ink">Leave quickly</strong> at the
            top.
          </li>
        </ul>
      </Disclosure>

      <StepActions>
        <p className="text-sm text-ink-2">About 5 minutes. Nothing is sent until the end.</p>
        <Button variant="primary" size="lg" onClick={() => setStep("verify")}>
          Start
        </Button>
      </StepActions>
    </section>
  );
}
