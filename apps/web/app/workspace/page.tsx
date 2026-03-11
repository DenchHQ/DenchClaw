import { redirect } from "next/navigation";

/**
 * Legacy /workspace route: redirect to root preserving query params.
 */
type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
};

export default async function WorkspaceRedirectPage({ searchParams }: PageProps) {
  const params = new URLSearchParams();
  const resolved = await searchParams;
  for (const [key, value] of Object.entries(resolved)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item);
      }
    } else if (typeof value === "string") {
      params.set(key, value);
    }
  }

  redirect(params.toString() ? `/?${params.toString()}` : "/");
}
