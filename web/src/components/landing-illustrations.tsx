/** Original line drawings for the public product story. No operational data. */
export function SupplyDrawing({
  kind = "stock",
}: {
  kind?: "stock" | "order" | "shield" | "delivery";
}) {
  if (kind === "shield")
    return (
      <svg viewBox="0 0 160 140" fill="none" aria-hidden="true">
        <path
          d="m80 15 43 17v32c0 28-18 46-43 60-25-14-43-32-43-60V32z"
          fill="currentColor"
          fillOpacity=".035"
        />
        <path
          d="m80 15 43 17v32c0 28-18 46-43 60-25-14-43-32-43-60V32zM80 27l31 12v25c0 21-13 35-31 47-18-12-31-26-31-47V39z"
          stroke="currentColor"
        />
        <path d="m65 65 11 11 21-24" stroke="currentColor" strokeWidth="2" />
        <path
          d="M16 55h21m86 0h21M20 92h23m74 0h23"
          stroke="currentColor"
          strokeDasharray="3 4"
        />
        <circle cx="14" cy="55" r="3" stroke="currentColor" />
        <circle cx="146" cy="55" r="3" stroke="currentColor" />
        <circle cx="18" cy="92" r="3" stroke="currentColor" />
        <circle cx="142" cy="92" r="3" stroke="currentColor" />
      </svg>
    );
  if (kind === "order")
    return (
      <svg viewBox="0 0 160 140" fill="none" aria-hidden="true">
        <path
          d="M38 20h58l25 25v78H38z"
          fill="currentColor"
          fillOpacity=".035"
        />
        <path
          d="M38 20h58l25 25v78H38zM96 20v25h25M52 57h42M52 72h54M52 87h37M52 102h24"
          stroke="currentColor"
        />
        <path d="m104 84 8 8 18-22" stroke="currentColor" strokeWidth="2" />
        <path
          d="M28 30h-7v103h90v-7"
          stroke="currentColor"
          strokeDasharray="3 4"
        />
      </svg>
    );
  if (kind === "delivery")
    return (
      <svg viewBox="0 0 160 140" fill="none" aria-hidden="true">
        <path
          d="M20 48h76v55H20zM96 65h25l20 20v18H96z"
          fill="currentColor"
          fillOpacity=".035"
        />
        <path
          d="M20 48h76v55H20zM96 65h25l20 20v18H96M105 73h13l15 15h-28z"
          stroke="currentColor"
        />
        <circle
          cx="45"
          cy="105"
          r="12"
          fill="var(--landing-paper)"
          stroke="currentColor"
        />
        <circle
          cx="117"
          cy="105"
          r="12"
          fill="var(--landing-paper)"
          stroke="currentColor"
        />
        <path
          d="M31 35h47M13 66H3m10 14H7m51-17v25m-12-13h24"
          stroke="currentColor"
        />
        <circle cx="45" cy="105" r="4" stroke="currentColor" />
        <circle cx="117" cy="105" r="4" stroke="currentColor" />
      </svg>
    );
  return (
    <svg viewBox="0 0 160 140" fill="none" aria-hidden="true">
      <path
        d="m80 22 49 26v53l-49 27-49-27V48z"
        fill="currentColor"
        fillOpacity=".035"
      />
      <path
        d="m80 22 49 26v53l-49 27-49-27V48zM31 48l49 27 49-27M80 75v53M55 35l49 27v21l-16 9V71L40 44"
        stroke="currentColor"
      />
      <path
        d="m58 91 13 7m-13-1 13 7M20 23h22m-11-11v22m107 65h12m-6-6v12"
        stroke="currentColor"
      />
      <path
        d="m31 112 49 27 49-27M80 11v10"
        stroke="currentColor"
        strokeDasharray="2 4"
      />
    </svg>
  );
}
