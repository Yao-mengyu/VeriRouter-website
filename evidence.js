// Keep the displayed request/response and the verifier's input identical.
export function exampleFor(bundle, variant) {
  return {
    question: bundle.question,
    clientRequest: bundle.client_request,
    clientApiRequest: bundle.client_api_request,
    forwardedApiRequest: variant === 'request' ? bundle.request_variant.forwarded_api_request : bundle.forwarded_api_request,
    model: variant === 'model' ? bundle.response_variants.model.model : bundle.selected_model_name,
    response: variant === 'request' ? bundle.request_variant.response
      : variant === 'response' ? bundle.response_variants.response.response : bundle.response,
    certificate: variant === 'request' ? bundle.request_variant.certificate : bundle.certificate
  };
}
