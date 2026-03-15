/**
 * Mock data for A2UI custom component Storybook stories
 * Organized by component name with export const for selective imports
 */

// ==================== CodeBlock Mock Data ====================

export const codeBlockSql = `-- Query active users with order statistics
SELECT
  u.id,
  u.username,
  u.email,
  COUNT(o.id) AS order_count,
  SUM(o.total_amount) AS total_spent
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.status = 'active'
  AND u.created_at >= '2024-01-01'
GROUP BY u.id, u.username, u.email
HAVING COUNT(o.id) > 5
ORDER BY total_spent DESC
LIMIT 20;`;

export const codeBlockJavaScript = `// Debounce utility with TypeScript support
function debounce(fn, delay = 300) {
  let timer = null;

  const debounced = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
      timer = null;
    }, delay);
  };

  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return debounced;
}

// Usage
const handleSearch = debounce((query) => {
  console.log('Searching for:', query);
  fetch(\`/api/search?q=\${encodeURIComponent(query)}\`)
    .then(res => res.json())
    .then(data => renderResults(data));
}, 500);`;

export const codeBlockPython = `import asyncio
from dataclasses import dataclass, field
from typing import Optional, List

@dataclass
class TaskResult:
    """Represents the result of an async task execution."""
    task_id: str
    status: str = "pending"
    data: Optional[dict] = None
    errors: List[str] = field(default_factory=list)

    @property
    def is_success(self) -> bool:
        return self.status == "completed" and not self.errors

async def process_batch(items: List[dict], concurrency: int = 5):
    """Process a batch of items with concurrency control."""
    semaphore = asyncio.Semaphore(concurrency)
    results: List[TaskResult] = []

    async def worker(item: dict) -> TaskResult:
        async with semaphore:
            result = TaskResult(task_id=item["id"])
            try:
                await asyncio.sleep(0.1)  # Simulate work
                result.status = "completed"
                result.data = {"processed": True}
            except Exception as e:
                result.status = "failed"
                result.errors.append(str(e))
            return result

    tasks = [worker(item) for item in items]
    results = await asyncio.gather(*tasks)
    return results`;

export const codeBlockGo = `package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// Server wraps an HTTP server with graceful shutdown support.
type Server struct {
	httpServer *http.Server
	logger     *log.Logger
}

// NewServer creates a new Server instance.
func NewServer(addr string, handler http.Handler) *Server {
	return &Server{
		httpServer: &http.Server{
			Addr:         addr,
			Handler:      handler,
			ReadTimeout:  15 * time.Second,
			WriteTimeout: 15 * time.Second,
			IdleTimeout:  60 * time.Second,
		},
		logger: log.New(os.Stdout, "[server] ", log.LstdFlags),
	}
}

// Start begins listening and serves requests with graceful shutdown.
func (s *Server) Start() error {
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		s.logger.Printf("Starting server on %s", s.httpServer.Addr)
		if err := s.httpServer.ListenAndServe(); err != http.ErrServerClosed {
			s.logger.Fatalf("Server error: %v", err)
		}
	}()

	<-quit
	s.logger.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	return s.httpServer.Shutdown(ctx)
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "OK")
	})

	server := NewServer(":8080", mux)
	if err := server.Start(); err != nil {
		log.Fatal(err)
	}
}`;

export const codeBlockJava = `import java.util.concurrent.*;
import java.util.stream.*;
import java.util.*;

/**
 * Generic thread-safe cache with TTL-based expiration.
 * @param <K> key type
 * @param <V> value type
 */
public class TTLCache<K, V> {

    private record CacheEntry<V>(V value, long expiresAt) {
        boolean isExpired() {
            return System.currentTimeMillis() > expiresAt;
        }
    }

    private final ConcurrentHashMap<K, CacheEntry<V>> store;
    private final long ttlMillis;
    private final ScheduledExecutorService cleaner;

    public TTLCache(long ttlMillis) {
        this.store = new ConcurrentHashMap<>();
        this.ttlMillis = ttlMillis;
        this.cleaner = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "cache-cleaner");
            t.setDaemon(true);
            return t;
        });
        this.cleaner.scheduleAtFixedRate(this::evictExpired, ttlMillis, ttlMillis, TimeUnit.MILLISECONDS);
    }

    public void put(K key, V value) {
        store.put(key, new CacheEntry<>(value, System.currentTimeMillis() + ttlMillis));
    }

    public Optional<V> get(K key) {
        CacheEntry<V> entry = store.get(key);
        if (entry == null || entry.isExpired()) {
            store.remove(key);
            return Optional.empty();
        }
        return Optional.of(entry.value());
    }

    private void evictExpired() {
        store.entrySet().removeIf(e -> e.getValue().isExpired());
    }

    public void shutdown() {
        cleaner.shutdown();
    }
}`;

export const codeBlockLong = `// A long code example that exceeds typical maxHeight to test scrolling
${Array.from({ length: 80 }, (_, i) => `const line${i + 1} = "This is line ${i + 1} of the long code block";`).join('\n')}

function processAllLines() {
${Array.from({ length: 80 }, (_, i) => `  console.log(line${i + 1});`).join('\n')}
}

processAllLines();`;

// ==================== Timeline Mock Data ====================

export const timelineDefault = [
  { title: 'Requirements Analysis', description: 'Gathered user requirements and defined scope', time: '2024-01-10 09:00', status: 'completed' as const },
  { title: 'System Design', description: 'Created architecture diagrams and API specifications', time: '2024-01-15 14:00', status: 'completed' as const },
  { title: 'Implementation', description: 'Core feature development in progress', time: '2024-01-20 10:00', status: 'active' as const },
  { title: 'Testing', description: 'Unit tests and integration tests', time: 'Estimated: 2024-02-01', status: 'pending' as const },
  { title: 'Deployment', description: 'Deploy to production environment', time: 'Estimated: 2024-02-10', status: 'pending' as const },
];

export const timelineMixedStatuses = [
  { title: 'Initialize Project', status: 'completed' as const, time: '10:00' },
  { title: 'Install Dependencies', status: 'completed' as const, time: '10:05' },
  { title: 'Configure Database', status: 'error' as const, description: 'Connection timeout - retrying with backup host', time: '10:10' },
  { title: 'Run Migrations', status: 'active' as const, time: '10:12' },
  { title: 'Seed Data', status: 'pending' as const },
  { title: 'Start Server', status: 'pending' as const },
];

export const timelineManyNodes = Array.from({ length: 15 }, (_, i) => ({
  title: `Step ${i + 1}: ${['Setup', 'Config', 'Build', 'Test', 'Lint', 'Bundle', 'Optimize', 'Sign', 'Upload', 'Verify', 'Notify', 'Cleanup', 'Archive', 'Report', 'Complete'][i]}`,
  description: `Automated pipeline stage ${i + 1}`,
  time: `${String(Math.floor(10 + i * 0.5)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`,
  status: (i < 8 ? 'completed' : i === 8 ? 'active' : 'pending') as 'completed' | 'active' | 'pending',
}));

export const timelineSingle = [
  { title: 'Application Started', description: 'Server listening on port 3000', time: '2024-01-20 08:00', status: 'active' as const },
];

export const timelineError = [
  { title: 'Fetch Data', status: 'completed' as const, time: '09:00' },
  { title: 'Validate Schema', status: 'completed' as const, time: '09:01' },
  { title: 'Process Records', status: 'error' as const, description: 'OutOfMemoryError: heap space exceeded (2GB limit)', time: '09:05' },
  { title: 'Generate Report', status: 'pending' as const },
];

// ==================== StatPanel → DataCard Dashboard Mock Data ====================

export const dataCardDashboard = [
  { title: 'Total Users', value: 24853, trend: 'up' as const, trendValue: '+12.5%', changeLabel: 'vs last month', sparkline: [18000, 19200, 20100, 21500, 22300, 23800, 24853] },
  { title: 'Revenue', value: 1250000, unit: 'USD', trend: 'down' as const, trendValue: '-3.2%', changeLabel: 'vs last month', sparkline: [1400000, 1380000, 1350000, 1290000, 1270000, 1260000, 1250000] },
  { title: 'Active Sessions', value: 1847, trend: 'flat' as const, trendValue: '0%', changeLabel: 'unchanged' },
  { title: 'Error Rate', value: '0.12%', trend: 'down' as const, trendValue: '-45%', changeLabel: 'vs last week', sparkline: [0.5, 0.4, 0.35, 0.25, 0.18, 0.15, 0.12] },
];

// ==================== Badge Mock Data ====================

export const badgeVariants = [
  { text: 'Deployed', variant: 'success' as const },
  { text: 'Pending Review', variant: 'warning' as const },
  { text: 'Build Failed', variant: 'error' as const },
  { text: 'In Progress', variant: 'info' as const },
  { text: 'Archived', variant: 'neutral' as const },
];

export const badgeCustomColor = { text: 'Custom Theme', color: '#8B5CF6' };

export const badgeWithIcons = [
  { text: 'Online', variant: 'success' as const, icon: '🟢' },
  { text: 'Maintenance', variant: 'warning' as const, icon: '🔧' },
  { text: 'Offline', variant: 'error' as const, icon: '🔴' },
  { text: 'Beta', variant: 'info' as const, icon: '🧪' },
  { text: 'Deprecated', variant: 'neutral' as const, icon: '📦' },
];

// ==================== JsonViewer Mock Data ====================

export const jsonViewerNested = {
  name: 'AgentStudio',
  version: '2.1.0',
  active: true,
  metrics: {
    uptime: 99.97,
    requestsPerSecond: 1250,
    averageLatency: 42.5,
    errorRate: null,
  },
  services: [
    {
      name: 'auth-service',
      status: 'healthy',
      replicas: 3,
      config: {
        timeout: 5000,
        retries: 3,
        features: ['oauth2', 'saml', 'mfa'],
      },
    },
    {
      name: 'data-pipeline',
      status: 'degraded',
      replicas: 2,
      config: {
        batchSize: 1000,
        parallelism: 8,
        features: ['streaming', 'backpressure'],
      },
    },
  ],
  metadata: {
    createdAt: '2024-01-15T08:30:00Z',
    updatedAt: '2024-03-10T14:22:00Z',
    tags: ['production', 'v2', 'critical'],
    owner: null,
    deprecated: false,
  },
};

export const jsonViewerLongString = {
  id: 'report-001',
  content: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
  summary: 'Short summary text',
};

// ==================== Chart Mock Data ====================

export const chartBarData = {
  chartType: 'bar',
  title: 'Monthly Sales Revenue',
  data: {
    categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    series: [
      { name: 'Product A', data: [120, 132, 101, 134, 90, 230, 210, 182, 191, 234, 290, 330] },
      { name: 'Product B', data: [220, 182, 191, 234, 290, 330, 310, 123, 442, 321, 90, 149] },
    ],
  },
};

export const chartLineData = {
  chartType: 'line',
  title: 'Daily Active Users Trend',
  data: {
    categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    series: [
      { name: 'This Week', data: [820, 932, 901, 934, 1290, 1330, 1120] },
      { name: 'Last Week', data: [620, 732, 801, 834, 1090, 1030, 920] },
    ],
  },
};

export const chartPieData = {
  chartType: 'pie',
  title: 'Traffic Source Distribution',
  data: [
    { name: 'Direct', value: 335 },
    { name: 'Search Engine', value: 580 },
    { name: 'Social Media', value: 234 },
    { name: 'Referral', value: 154 },
    { name: 'Email Campaign', value: 98 },
  ],
};

// ==================== Table Mock Data ====================

export const tableColumns = [
  { key: 'id', label: 'ID', align: 'center' as const, width: '60px' },
  { key: 'name', label: 'Name', align: 'left' as const },
  { key: 'role', label: 'Role', align: 'left' as const },
  { key: 'status', label: 'Status', align: 'center' as const },
  { key: 'score', label: 'Score', align: 'right' as const, width: '80px' },
];

export const tableData = [
  { id: 1, name: 'Alice Chen', role: 'Frontend Engineer', status: 'Active', score: 92 },
  { id: 2, name: 'Bob Smith', role: 'Backend Engineer', status: 'Active', score: 88 },
  { id: 3, name: 'Carol Zhang', role: 'Product Manager', status: 'Active', score: 95 },
  { id: 4, name: 'David Lee', role: 'DevOps Engineer', status: 'Inactive', score: 76 },
  { id: 5, name: 'Eva Garcia', role: 'UX Designer', status: 'Active', score: 91 },
  { id: 6, name: 'Frank Wang', role: 'Data Scientist', status: 'Active', score: 87 },
  { id: 7, name: 'Grace Liu', role: 'QA Engineer', status: 'Active', score: 83 },
  { id: 8, name: 'Henry Kim', role: 'Frontend Engineer', status: 'Inactive', score: 79 },
  { id: 9, name: 'Iris Patel', role: 'Backend Engineer', status: 'Active', score: 94 },
  { id: 10, name: 'Jack Wilson', role: 'Product Manager', status: 'Active', score: 86 },
  { id: 11, name: 'Karen Zhao', role: 'DevOps Engineer', status: 'Active', score: 90 },
  { id: 12, name: 'Leo Martin', role: 'UX Designer', status: 'Inactive', score: 72 },
  { id: 13, name: 'Mia Johnson', role: 'Data Scientist', status: 'Active', score: 93 },
  { id: 14, name: 'Nathan Brown', role: 'QA Engineer', status: 'Active', score: 85 },
  { id: 15, name: 'Olivia Wu', role: 'Frontend Engineer', status: 'Active', score: 89 },
  { id: 16, name: 'Peter Davis', role: 'Backend Engineer', status: 'Inactive', score: 77 },
  { id: 17, name: 'Quinn Taylor', role: 'Product Manager', status: 'Active', score: 91 },
  { id: 18, name: 'Rachel Huang', role: 'DevOps Engineer', status: 'Active', score: 88 },
  { id: 19, name: 'Sam Anderson', role: 'UX Designer', status: 'Active', score: 84 },
  { id: 20, name: 'Tina Li', role: 'Data Scientist', status: 'Active', score: 96 },
  { id: 21, name: 'Uma Patel', role: 'QA Engineer', status: 'Inactive', score: 73 },
  { id: 22, name: 'Victor Zhao', role: 'Frontend Engineer', status: 'Active', score: 90 },
];

// ==================== DataCard Mock Data ====================

export const dataCardUp = {
  title: 'Monthly Revenue',
  value: 128500,
  unit: 'USD',
  trend: 'up' as const,
  trendValue: '+12.5%',
  icon: '💰',
};

export const dataCardDown = {
  title: 'Error Rate',
  value: '3.2%',
  trend: 'down' as const,
  trendValue: '-0.8%',
  icon: '⚠️',
};

export const dataCardFlat = {
  title: 'Active Sessions',
  value: 1847,
  trend: 'flat' as const,
  trendValue: '0%',
};

export const dataCardWithIcon = {
  title: 'CPU Usage',
  value: '67.3%',
  trend: 'up' as const,
  trendValue: '+5.2%',
  icon: '🖥️',
};

// ==================== Progress Mock Data ====================

export const progressLinearSteps = [
  { value: 0, label: 'Not Started', color: '#9ca3af' },
  { value: 25, label: 'Phase 1', color: '#f59e0b' },
  { value: 50, label: 'Halfway', color: '#3b82f6' },
  { value: 75, label: 'Phase 3', color: '#8b5cf6' },
  { value: 100, label: 'Complete', color: '#22c55e' },
];

export const progressCircularSteps = [
  { value: 0, label: 'Idle', color: '#9ca3af' },
  { value: 25, label: 'Loading', color: '#f59e0b' },
  { value: 50, label: 'Processing', color: '#3b82f6' },
  { value: 75, label: 'Finalizing', color: '#8b5cf6' },
  { value: 100, label: 'Done', color: '#22c55e' },
];

// ==================== Markdown Mock Data ====================

export const markdownRichContent = `# Project Overview

## Introduction

This is a **comprehensive** demonstration of the Markdown renderer. It supports *italic text*, **bold text**, and \`inline code\`.

### Features

- Unordered list item 1
- Unordered list item 2
- Unordered list item 3

1. First ordered item
2. Second ordered item
3. Third ordered item

## Code Example

\`\`\`javascript
function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

## Useful Links

Visit [GitHub](https://github.com) for source code and [MDN](https://developer.mozilla.org) for documentation.

## Data Summary

| Metric | Value | Status |
|--------|-------|--------|
| Uptime | 99.9% | Good |
| Latency | 42ms | Normal |
| Error Rate | 0.1% | Low |
`;

export const markdownCodeSnippet = `# Code Snippets

## TypeScript Example

\`\`\`typescript
interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'user' | 'guest';
}

async function fetchUser(id: number): Promise<User> {
  const response = await fetch(\`/api/users/\${id}\`);
  if (!response.ok) {
    throw new Error(\`Failed to fetch user \${id}\`);
  }
  return response.json();
}
\`\`\`

## Python Example

\`\`\`python
from dataclasses import dataclass

@dataclass
class Config:
    host: str = "localhost"
    port: int = 8080
    debug: bool = False

config = Config(host="0.0.0.0", port=3000, debug=True)
print(f"Server running at {config.host}:{config.port}")
\`\`\`
`;

// ==================== Slider Mock Data ====================

export const sliderDefault = {
  value: 50,
  minValue: 0,
  maxValue: 100,
};

export const sliderCustomRange = {
  value: 25,
  minValue: 0,
  maxValue: 50,
};

// ==================== DateTimeInput Mock Data ====================

export const dateTimeInputDateOnly = {
  value: '2024-06-15',
  enableDate: true,
  enableTime: false,
};

export const dateTimeInputTimeOnly = {
  value: '14:30',
  enableDate: false,
  enableTime: true,
};

export const dateTimeInputBoth = {
  value: '2024-06-15T14:30',
  enableDate: true,
  enableTime: true,
};
