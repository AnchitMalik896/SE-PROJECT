/** Call after any cart mutation so the sidebar cart badge refreshes. */
export const emitCartChanged = () => window.dispatchEvent(new Event('fd:cart'));
/** Call after reading/marking notifications so the bell badge refreshes. */
export const emitNotificationsChanged = () => window.dispatchEvent(new Event('fd:notifications'));
