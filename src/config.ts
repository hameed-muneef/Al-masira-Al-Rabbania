// Build-time configuration for the local-only mobile variant.
// Set VITE_LOCAL_ONLY=true to disable accounts, cloud sync, payments and
// any feature that requires a network connection. Internet features are then
// shown separately and only when connectivity is available.
export const LOCAL_ONLY = import.meta.env.VITE_LOCAL_ONLY === 'true';