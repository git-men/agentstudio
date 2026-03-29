#!/usr/bin/env node
/**
 * ClawStudio CLI — standalone entry point for AgentStudio platform management.
 *
 * Equivalent to `agentstudio admin`, but as a top-level command:
 *   clawstudio tools        = agentstudio admin tools
 *   clawstudio call <tool>  = agentstudio admin call <tool>
 *   clawstudio describe     = agentstudio admin describe
 *   clawstudio ping         = agentstudio admin ping
 *   clawstudio batch        = agentstudio admin batch
 */

import { createAdminCommand } from '../cli/admin.js';

const program = createAdminCommand('clawstudio');
program.description('ClawStudio CLI — Manage AgentStudio platform resources');
program.parse();
