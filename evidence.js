// Keep the displayed request/response and the verifier's input identical.
export function exampleFor(bundle, variant) {
  const ineligibleSelection = variant === 'selection' || variant === 'model';
  const serving = variant === 'request' ? bundle.request_variant
    : ineligibleSelection ? bundle.selection_variant : bundle;
  return {
    question: bundle.question,
    clientRequest: bundle.client_request,
    clientApiRequest: bundle.client_api_request,
    forwardedApiRequest: serving.forwarded_api_request,
    model: variant === 'model' ? bundle.response_variants.model.model
      : ineligibleSelection ? bundle.selection_variant.model : bundle.selected_model_name,
    response: variant === 'model' ? bundle.response_variants.model.response
      : variant === 'response' ? bundle.response_variants.response.response : serving.response,
    certificate: serving.certificate
  };
}
