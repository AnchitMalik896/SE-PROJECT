export const emitCartChanged = () => window.dispatchEvent(new Event('fd:cart'));
export const emitNotificationsChanged = () => window.dispatchEvent(new Event('fd:notifications'));
