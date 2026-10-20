// Preserve the ready assertion, but do not wait out the UI deadline after the
// native assistant has already reported a terminal error.
export function assistantProposalReady(state) {
  const assistant = state?.assistant;
  if (assistant?.status === 'error') {
    throw Error('Offline assistant failed before readiness: ' + String(assistant.message ?? 'No failure category supplied').slice(0, 500));
  }
  return assistant?.status === 'ready' && assistant.proposal?.previewReady === true;
}
