/**
 * Savvagent PagerDuty MCP Server
 * Pull-based MCP server that exposes PagerDuty incident management via JSON-RPC 2.0 tools
 */

import axios, { AxiosInstance } from 'axios';
import { MCPServer, MCPServerConfig } from '@savvagent/mcp-sdk';

/**
 * PagerDuty configuration options
 */
export interface PagerDutyConfig {
  /** PagerDuty API token (REST API v2) */
  apiToken: string;
  /** PagerDuty service integration key for events (optional) */
  routingKey?: string;
}

/**
 * PagerDuty MCP Server
 */
export class PagerDutyMCPServer extends MCPServer {
  private apiClient!: AxiosInstance;
  private pagerDutyConfig: PagerDutyConfig;

  constructor(config: MCPServerConfig, pagerDutyConfig: PagerDutyConfig) {
    super(config);
    this.pagerDutyConfig = pagerDutyConfig;
    this.registerPagerDutyTools();
  }

  async initialize(): Promise<void> {
    this.apiClient = axios.create({
      baseURL: 'https://api.pagerduty.com',
      headers: {
        'Authorization': `Token token=${this.pagerDutyConfig.apiToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.pagerduty+json;version=2',
      },
    });

    try {
      await this.apiClient.get('/users?limit=1');
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to connect to PagerDuty: ${error}`);
    }
  }

  private registerPagerDutyTools(): void {
    // get_incidents - List incidents
    this.registerTool(
      'get_incidents',
      'Get PagerDuty incidents',
      {
        type: 'object',
        properties: {
          status: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['triggered', 'acknowledged', 'resolved'],
            },
            description: 'Filter by status',
          },
          urgency: {
            type: 'string',
            description: 'Filter by urgency',
            enum: ['high', 'low'],
          },
          service_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by service IDs',
          },
          since: {
            type: 'string',
            description: 'Start date (ISO 8601)',
          },
          until: {
            type: 'string',
            description: 'End date (ISO 8601)',
          },
          limit: {
            type: 'integer',
            description: 'Maximum results',
            minimum: 1,
            maximum: 100,
            default: 25,
          },
        },
        required: [],
      },
      async (args) => this.getIncidents(args)
    );

    // get_incident_details - Get single incident details
    this.registerTool(
      'get_incident_details',
      'Get detailed information about a specific incident',
      {
        type: 'object',
        properties: {
          incident_id: {
            type: 'string',
            description: 'Incident ID',
          },
        },
        required: ['incident_id'],
      },
      async (args) => this.getIncidentDetails(args.incident_id)
    );

    // get_services - List services
    this.registerTool(
      'get_services',
      'List PagerDuty services',
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query for service name',
          },
          include: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['escalation_policies', 'teams', 'integrations'],
            },
            description: 'Additional data to include',
          },
        },
        required: [],
      },
      async (args) => this.getServices(args)
    );

    // get_on_call - Get current on-call users
    this.registerTool(
      'get_on_call',
      'Get current on-call users for escalation policies',
      {
        type: 'object',
        properties: {
          escalation_policy_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by escalation policy IDs',
          },
          schedule_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by schedule IDs',
          },
        },
        required: [],
      },
      async (args) => this.getOnCall(args)
    );

    // get_schedules - List schedules
    this.registerTool(
      'get_schedules',
      'List PagerDuty schedules',
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query for schedule name',
          },
        },
        required: [],
      },
      async (args) => this.getSchedules(args.query)
    );

    // get_escalation_policies - List escalation policies
    this.registerTool(
      'get_escalation_policies',
      'List PagerDuty escalation policies',
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query for policy name',
          },
        },
        required: [],
      },
      async (args) => this.getEscalationPolicies(args.query)
    );

    // get_users - List users
    this.registerTool(
      'get_users',
      'List PagerDuty users',
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query for user name or email',
          },
          include: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['contact_methods', 'notification_rules', 'teams'],
            },
            description: 'Additional data to include',
          },
        },
        required: [],
      },
      async (args) => this.getUsers(args)
    );

    // get_analytics - Get incident analytics
    this.registerTool(
      'get_analytics',
      'Get incident analytics and metrics',
      {
        type: 'object',
        properties: {
          since: {
            type: 'string',
            description: 'Start date (ISO 8601)',
          },
          until: {
            type: 'string',
            description: 'End date (ISO 8601)',
          },
          service_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by service IDs',
          },
        },
        required: [],
      },
      async (args) => this.getAnalytics(args)
    );

    // create_incident - Create a new incident
    this.registerTool(
      'create_incident',
      'Create a new PagerDuty incident',
      {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Incident title',
          },
          service_id: {
            type: 'string',
            description: 'Service ID to create incident on',
          },
          urgency: {
            type: 'string',
            description: 'Incident urgency',
            enum: ['high', 'low'],
            default: 'high',
          },
          body: {
            type: 'string',
            description: 'Incident description/body',
          },
          escalation_policy_id: {
            type: 'string',
            description: 'Escalation policy ID (optional)',
          },
        },
        required: ['title', 'service_id'],
      },
      async (args) => this.createIncident(args as {
        title: string;
        service_id: string;
        urgency?: string;
        body?: string;
        escalation_policy_id?: string;
      })
    );

    // update_incident - Update an incident
    this.registerTool(
      'update_incident',
      'Update a PagerDuty incident (acknowledge, resolve, etc.)',
      {
        type: 'object',
        properties: {
          incident_id: {
            type: 'string',
            description: 'Incident ID',
          },
          status: {
            type: 'string',
            description: 'New status',
            enum: ['acknowledged', 'resolved'],
          },
          resolution: {
            type: 'string',
            description: 'Resolution note (for resolved status)',
          },
        },
        required: ['incident_id', 'status'],
      },
      async (args) => this.updateIncident(args as {
        incident_id: string;
        status: string;
        resolution?: string;
      })
    );

    // get_alerts - Get alerts for an incident
    this.registerTool(
      'get_alerts',
      'Get alerts associated with an incident',
      {
        type: 'object',
        properties: {
          incident_id: {
            type: 'string',
            description: 'Incident ID',
          },
        },
        required: ['incident_id'],
      },
      async (args) => this.getAlerts(args.incident_id)
    );
  }

  private async getIncidents(args: {
    status?: string[];
    urgency?: string;
    service_ids?: string[];
    since?: string;
    until?: string;
    limit?: number;
  }) {
    const params = new URLSearchParams();

    if (args.status?.length) {
      args.status.forEach(s => params.append('statuses[]', s));
    }
    if (args.urgency) {
      params.append('urgencies[]', args.urgency);
    }
    if (args.service_ids?.length) {
      args.service_ids.forEach(id => params.append('service_ids[]', id));
    }
    if (args.since) {
      params.append('since', args.since);
    }
    if (args.until) {
      params.append('until', args.until);
    }
    params.append('limit', String(args.limit || 25));

    const response = await this.apiClient.get(`/incidents?${params.toString()}`);

    return {
      incidents: response.data.incidents.map((inc: any) => ({
        id: inc.id,
        incident_number: inc.incident_number,
        title: inc.title,
        status: inc.status,
        urgency: inc.urgency,
        priority: inc.priority?.summary,
        service: {
          id: inc.service?.id,
          name: inc.service?.summary,
        },
        assignees: inc.assignments?.map((a: any) => ({
          id: a.assignee?.id,
          name: a.assignee?.summary,
        })),
        created_at: inc.created_at,
        last_status_change_at: inc.last_status_change_at,
        resolved_at: inc.resolved_at,
        escalation_policy: {
          id: inc.escalation_policy?.id,
          name: inc.escalation_policy?.summary,
        },
      })),
      meta: {
        total: response.data.incidents.length,
        more: response.data.more,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async getIncidentDetails(incidentId: string) {
    const response = await this.apiClient.get(`/incidents/${incidentId}`);
    const inc = response.data.incident;

    // Also get timeline/log entries
    const logResponse = await this.apiClient.get(`/incidents/${incidentId}/log_entries`);

    return {
      incident: {
        id: inc.id,
        incident_number: inc.incident_number,
        title: inc.title,
        description: inc.description,
        status: inc.status,
        urgency: inc.urgency,
        priority: inc.priority,
        service: inc.service,
        escalation_policy: inc.escalation_policy,
        teams: inc.teams,
        assignees: inc.assignments?.map((a: any) => a.assignee),
        acknowledgers: inc.acknowledgements?.map((a: any) => ({
          user: a.acknowledger,
          at: a.at,
        })),
        created_at: inc.created_at,
        last_status_change_at: inc.last_status_change_at,
        last_status_change_by: inc.last_status_change_by,
        resolved_at: inc.resolved_at,
        html_url: inc.html_url,
      },
      timeline: logResponse.data.log_entries.map((entry: any) => ({
        id: entry.id,
        type: entry.type,
        summary: entry.summary,
        created_at: entry.created_at,
        agent: entry.agent,
        channel: entry.channel,
      })),
      meta: {
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async getServices(args: { query?: string; include?: string[] }) {
    const params = new URLSearchParams();
    params.append('limit', '100');

    if (args.query) {
      params.append('query', args.query);
    }
    if (args.include?.length) {
      args.include.forEach(i => params.append('include[]', i));
    }

    const response = await this.apiClient.get(`/services?${params.toString()}`);

    return {
      services: response.data.services.map((svc: any) => ({
        id: svc.id,
        name: svc.name,
        description: svc.description,
        status: svc.status,
        auto_resolve_timeout: svc.auto_resolve_timeout,
        acknowledgement_timeout: svc.acknowledgement_timeout,
        escalation_policy: svc.escalation_policy ? {
          id: svc.escalation_policy.id,
          name: svc.escalation_policy.summary,
        } : null,
        teams: svc.teams?.map((t: any) => ({
          id: t.id,
          name: t.summary,
        })),
        integrations: svc.integrations?.map((i: any) => ({
          id: i.id,
          type: i.type,
          name: i.summary,
        })),
      })),
      meta: {
        total: response.data.services.length,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async getOnCall(args: { escalation_policy_ids?: string[]; schedule_ids?: string[] }) {
    const params = new URLSearchParams();

    if (args.escalation_policy_ids?.length) {
      args.escalation_policy_ids.forEach(id => params.append('escalation_policy_ids[]', id));
    }
    if (args.schedule_ids?.length) {
      args.schedule_ids.forEach(id => params.append('schedule_ids[]', id));
    }

    const response = await this.apiClient.get(`/oncalls?${params.toString()}`);

    return {
      oncalls: response.data.oncalls.map((oc: any) => ({
        user: {
          id: oc.user?.id,
          name: oc.user?.summary,
          email: oc.user?.email,
          html_url: oc.user?.html_url,
        },
        schedule: oc.schedule ? {
          id: oc.schedule.id,
          name: oc.schedule.summary,
        } : null,
        escalation_policy: oc.escalation_policy ? {
          id: oc.escalation_policy.id,
          name: oc.escalation_policy.summary,
        } : null,
        escalation_level: oc.escalation_level,
        start: oc.start,
        end: oc.end,
      })),
      meta: {
        total: response.data.oncalls.length,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async getSchedules(query?: string) {
    const params = new URLSearchParams();
    params.append('limit', '100');

    if (query) {
      params.append('query', query);
    }

    const response = await this.apiClient.get(`/schedules?${params.toString()}`);

    return {
      schedules: response.data.schedules.map((sched: any) => ({
        id: sched.id,
        name: sched.name,
        description: sched.description,
        time_zone: sched.time_zone,
        escalation_policies: sched.escalation_policies?.map((ep: any) => ({
          id: ep.id,
          name: ep.summary,
        })),
        users: sched.users?.map((u: any) => ({
          id: u.id,
          name: u.summary,
        })),
      })),
      meta: {
        total: response.data.schedules.length,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async getEscalationPolicies(query?: string) {
    const params = new URLSearchParams();
    params.append('limit', '100');

    if (query) {
      params.append('query', query);
    }

    const response = await this.apiClient.get(`/escalation_policies?${params.toString()}`);

    return {
      escalation_policies: response.data.escalation_policies.map((ep: any) => ({
        id: ep.id,
        name: ep.name,
        description: ep.description,
        num_loops: ep.num_loops,
        on_call_handoff_notifications: ep.on_call_handoff_notifications,
        escalation_rules: ep.escalation_rules?.map((rule: any) => ({
          escalation_delay_in_minutes: rule.escalation_delay_in_minutes,
          targets: rule.targets?.map((t: any) => ({
            id: t.id,
            type: t.type,
            name: t.summary,
          })),
        })),
        services: ep.services?.map((s: any) => ({
          id: s.id,
          name: s.summary,
        })),
        teams: ep.teams?.map((t: any) => ({
          id: t.id,
          name: t.summary,
        })),
      })),
      meta: {
        total: response.data.escalation_policies.length,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async getUsers(args: { query?: string; include?: string[] }) {
    const params = new URLSearchParams();
    params.append('limit', '100');

    if (args.query) {
      params.append('query', args.query);
    }
    if (args.include?.length) {
      args.include.forEach(i => params.append('include[]', i));
    }

    const response = await this.apiClient.get(`/users?${params.toString()}`);

    return {
      users: response.data.users.map((user: any) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        time_zone: user.time_zone,
        job_title: user.job_title,
        teams: user.teams?.map((t: any) => ({
          id: t.id,
          name: t.summary,
        })),
        contact_methods: user.contact_methods?.map((cm: any) => ({
          id: cm.id,
          type: cm.type,
          address: cm.address,
        })),
      })),
      meta: {
        total: response.data.users.length,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async getAnalytics(args: { since?: string; until?: string; service_ids?: string[] }) {
    // Calculate default date range (last 7 days)
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const since = args.since || weekAgo.toISOString();
    const until = args.until || now.toISOString();

    // Get incidents for the period
    const params = new URLSearchParams();
    params.append('since', since);
    params.append('until', until);
    params.append('limit', '100');

    if (args.service_ids?.length) {
      args.service_ids.forEach(id => params.append('service_ids[]', id));
    }

    const response = await this.apiClient.get(`/incidents?${params.toString()}`);
    const incidents = response.data.incidents;

    // Calculate metrics
    const totalIncidents = incidents.length;
    const byStatus: Record<string, number> = {};
    const byUrgency: Record<string, number> = {};
    const byService: Record<string, { id: string; name: string; count: number }> = {};

    let totalAckTime = 0;
    let totalResolveTime = 0;
    let ackedCount = 0;
    let resolvedCount = 0;

    incidents.forEach((inc: any) => {
      // Count by status
      byStatus[inc.status] = (byStatus[inc.status] || 0) + 1;

      // Count by urgency
      byUrgency[inc.urgency] = (byUrgency[inc.urgency] || 0) + 1;

      // Count by service
      const serviceId = inc.service?.id || 'unknown';
      const serviceName = inc.service?.summary || 'Unknown';
      if (!byService[serviceId]) {
        byService[serviceId] = { id: serviceId, name: serviceName, count: 0 };
      }
      byService[serviceId].count++;

      // Calculate times
      if (inc.first_trigger_log_entry && inc.acknowledgements?.length > 0) {
        const triggerTime = new Date(inc.created_at).getTime();
        const ackTime = new Date(inc.acknowledgements[0].at).getTime();
        totalAckTime += ackTime - triggerTime;
        ackedCount++;
      }

      if (inc.resolved_at) {
        const triggerTime = new Date(inc.created_at).getTime();
        const resolveTime = new Date(inc.resolved_at).getTime();
        totalResolveTime += resolveTime - triggerTime;
        resolvedCount++;
      }
    });

    return {
      summary: {
        total_incidents: totalIncidents,
        by_status: byStatus,
        by_urgency: byUrgency,
        avg_acknowledgement_time_seconds: ackedCount > 0 ? Math.round(totalAckTime / ackedCount / 1000) : null,
        avg_resolution_time_seconds: resolvedCount > 0 ? Math.round(totalResolveTime / resolvedCount / 1000) : null,
      },
      by_service: Object.values(byService).sort((a, b) => b.count - a.count),
      meta: {
        since,
        until,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async createIncident(args: {
    title: string;
    service_id: string;
    urgency?: string;
    body?: string;
    escalation_policy_id?: string;
  }) {
    const incidentData: any = {
      incident: {
        type: 'incident',
        title: args.title,
        service: {
          id: args.service_id,
          type: 'service_reference',
        },
        urgency: args.urgency || 'high',
      },
    };

    if (args.body) {
      incidentData.incident.body = {
        type: 'incident_body',
        details: args.body,
      };
    }

    if (args.escalation_policy_id) {
      incidentData.incident.escalation_policy = {
        id: args.escalation_policy_id,
        type: 'escalation_policy_reference',
      };
    }

    const response = await this.apiClient.post('/incidents', incidentData);
    const inc = response.data.incident;

    return {
      incident: {
        id: inc.id,
        incident_number: inc.incident_number,
        title: inc.title,
        status: inc.status,
        urgency: inc.urgency,
        service: inc.service,
        created_at: inc.created_at,
        html_url: inc.html_url,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async updateIncident(args: {
    incident_id: string;
    status: string;
    resolution?: string;
  }) {
    const incidentData: any = {
      incident: {
        type: 'incident',
        status: args.status,
      },
    };

    if (args.status === 'resolved' && args.resolution) {
      incidentData.incident.resolution = args.resolution;
    }

    const response = await this.apiClient.put(`/incidents/${args.incident_id}`, incidentData);
    const inc = response.data.incident;

    return {
      incident: {
        id: inc.id,
        incident_number: inc.incident_number,
        title: inc.title,
        status: inc.status,
        urgency: inc.urgency,
        last_status_change_at: inc.last_status_change_at,
        resolved_at: inc.resolved_at,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async getAlerts(incidentId: string) {
    const response = await this.apiClient.get(`/incidents/${incidentId}/alerts`);

    return {
      alerts: response.data.alerts.map((alert: any) => ({
        id: alert.id,
        type: alert.type,
        status: alert.status,
        severity: alert.severity,
        summary: alert.summary,
        created_at: alert.created_at,
        suppressed: alert.suppressed,
        body: alert.body,
        integration: alert.integration ? {
          id: alert.integration.id,
          type: alert.integration.type,
          name: alert.integration.summary,
        } : null,
      })),
      meta: {
        total: response.data.alerts.length,
        timestamp: new Date().toISOString(),
      },
    };
  }

  async healthCheck() {
    try {
      await this.apiClient.get('/abilities');
      return {
        status: 'ok' as const,
        version: this.config.version,
        timestamp: new Date().toISOString(),
        details: {
          connected: true,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy' as const,
        version: this.config.version,
        timestamp: new Date().toISOString(),
        details: {
          connected: false,
          error: String(error),
        },
      };
    }
  }

  async shutdown(): Promise<void> {
    await super.shutdown();
  }
}
