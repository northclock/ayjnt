import type { SVGProps } from "react";

/**
 * The npm mark. Pairs with {@link GithubIcon}: lucide-react has no brand
 * logos, so the npm links were falling back to a generic `Package` box.
 * `fill="currentColor"` makes it inherit the surrounding text color, so it
 * drops in beside the lucide icons (sized with the same `h-4 w-4` classes).
 */
export function NpmIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0H1.763zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113V5.323z" />
    </svg>
  );
}
