export const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
export const identityUrl = process.env.NEXT_PUBLIC_IDENTITY_URL ?? "";
export const showcaseMode = apiUrl.length === 0;
export const defaultCampaign = process.env.NEXT_PUBLIC_DEFAULT_CAMPAIGN ?? "northwind-ethics";
