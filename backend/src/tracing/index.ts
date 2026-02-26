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
 *  - Exports spans via OTLP/HTTP (JSON) to the configured endpoint with optional x-bk-token auth.
 *
 * Uses `fetch` (Node.js 20+) instead of the default Node.js `http` stream-piping
 * transport, which sends `Transfer-Encoding: chunked` — some OTLP receivers
 * (e.g. 蓝鲸 APM) reject chunked requests with HTTP 400.  `fetch` sends a fixed
 * `Content-Length` body that is universally accepted.
 *
 * Environment variables (all optional, tracing is disabled unless TRACE_ENABLED=true):
 *  TRACE_ENABLED   - "true" to enable (default: disabled)
 *  TRACE_ENDPOINT  - OTLP HTTP endpoint, e.g. "http://localhost:4318/v1/traces"
 *  TRACE_BK_TOKEN  - Value for the `x-bk-token` header sent with every OTLP request
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import {
  ParentBasedSampler,
  AlwaysOffSampler,
  AlwaysOnSampler,
} from '@opentelemetry/sdk-trace-base';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { JsonTraceSerializer } from '@opentelemetry/otlp-transformer';

/**
 * Lightweight OTLP/HTTP trace exporter that uses the global `fetch` API.
 *
 * Unlike the default `@opentelemetry/exporter-trace-otlp-http` which pipes a
 * Readable stream to `http.request` (resulting in Transfer-Encoding: chunked),
 * this exporter passes a Uint8Array body to `fetch`, which automatically sets
 * Content-Length — compatible with all OTLP receivers.
 */
class OTLPFetchTraceExporter implements SpanExporter {
  private url: string;
  private headers: Record<string, string>;

  constructor(config: { url: string; headers?: Record<string, string> }) {
    this.url = config.url;
    this.headers = {
      'Content-Type': 'application/json',
      ...config.headers,
    };
  }

  export(
    spans: ReadableSpan[],
    resultCallback: (result: { code: number; error?: Error }) => void,
  ): void {
    const body = JsonTraceSerializer.serializeRequest(spans);

    fetch(this.url, {
      method: 'POST',
      headers: this.headers,
      body,
    })
      .then((res) => {
        if (res.status >= 200 && res.status < 300) {
          resultCallback({ code: 0 }); // SUCCESS
        } else {
          resultCallback({
            code: 1, // FAILED
            error: new Error(`OTLP trace export failed: HTTP ${res.status}`),
          });
        }
      })
      .catch((err) => {
        resultCallback({ code: 1, error: err });
      });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

const enabled = process.env.TRACE_ENABLED === 'true';
const endpoint = process.env.TRACE_ENDPOINT;
const bkToken = process.env.TRACE_BK_TOKEN;

if (enabled && endpoint) {
  const exporter = new OTLPFetchTraceExporter({
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
    // Disable auto-configured metric/log exporters — we only need traces
    metricReaders: [],
    logRecordProcessors: [],
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
