/**
 * OpenTelemetry tracing initialization.
 *
 * MUST be imported at the very top of the entry point (before Express, HTTP, etc.)
 * so that auto-instrumentation can monkey-patch Node.js modules.
 *
 * Behaviour:
 *  - Uses ParentBasedSampler with AlwaysOffSampler as root → only creates spans
 *    when the incoming request carries a valid `traceparent` header with sampled flag.
 *  - When no upstream trace context exists, no span is created (zero overhead).
 *  - Exports spans via OTLP/HTTP to the configured endpoint with optional x-bk-token auth.
 *
 * Environment variables (all optional, tracing is disabled unless TRACE_ENABLED=true):
 *  TRACE_ENABLED   - "true" to enable (default: disabled)
 *  TRACE_ENDPOINT  - OTLP HTTP endpoint, e.g. "http://localhost:4318/v1/traces"
 *  TRACE_BK_TOKEN  - Value for the `x-bk-token` header sent with every OTLP request
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import {
  ParentBasedSampler,
  AlwaysOffSampler,
  AlwaysOnSampler,
} from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const enabled = process.env.TRACE_ENABLED === 'true';
const endpoint = process.env.TRACE_ENDPOINT;
const bkToken = process.env.TRACE_BK_TOKEN;

if (enabled && endpoint) {
  const exporter = new OTLPTraceExporter({
    url: endpoint,
    headers: bkToken ? { 'x-bk-token': bkToken } : {},
  });

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'agentstudio',
    }),
    traceExporter: exporter,
    sampler: new ParentBasedSampler({
      root: new AlwaysOffSampler(),
      remoteParentSampled: new AlwaysOnSampler(),
      remoteParentNotSampled: new AlwaysOffSampler(),
    }),
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
    ],
  });

  sdk.start();
  console.log(`[Tracing] OTLP enabled → ${endpoint}`);

  const shutdown = () => {
    sdk.shutdown().catch(console.error);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} else if (enabled && !endpoint) {
  console.warn('[Tracing] TRACE_ENABLED=true but TRACE_ENDPOINT is not set — tracing disabled');
}
