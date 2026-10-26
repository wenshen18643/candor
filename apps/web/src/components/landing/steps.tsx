const steps = [
  {
    title: "Prove you're real",
    body: "Scan your passport with the Self app. We learn yes or no, never your name.",
  },
  {
    title: "Clean and lock",
    body: "Names and hidden file details are removed on your device. Then your files are locked.",
  },
  {
    title: "Answer questions",
    body: "Reviewers get a checked timeline and can ask you things. You reply with eight secret words.",
  },
];

export function Steps() {
  return (
    <section aria-labelledby="steps-title">
      <div className="mx-auto w-full max-w-[1200px] px-5 py-20 sm:px-8 sm:py-24">
        <h2
          id="steps-title"
          className="text-2xl font-semibold tracking-[-0.02em] text-balance sm:text-3xl"
        >
          Three steps. Nothing about you.
        </h2>
        <ol className="mt-10 grid gap-8 md:grid-cols-3 md:gap-10">
          {steps.map((step, index) => (
            <li key={step.title} className="border-t border-line-strong pt-5">
              <span className="tabular font-mono text-sm text-seal-ink">{index + 1}</span>
              <h3 className="mt-2 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 max-w-[32ch] text-md text-ink-2">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
