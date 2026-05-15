import type { Notification, JobRun } from "@shared/schema";
import { storage } from "../storage";

export class NotificationService {
  async triggerNotifications(run: JobRun) {
    // Always scope notifications to the run's org — never fire cross-tenant.
    const notifications = await storage.getNotifications(run.orgId);
    const enabledNotifications = notifications.filter(n => n.enabled);

    for (const notification of enabledNotifications) {
      // Check if notification should trigger based on run status
      const shouldTrigger = 
        (notification.onSuccess && run.status === "ok") ||
        (notification.onFailure && run.status === "failed");

      if (!shouldTrigger) continue;

      // Check if notification is scoped to specific templates
      if (notification.templateIds && notification.templateIds.length > 0) {
        if (!notification.templateIds.includes(run.templateId)) {
          continue;
        }
      }

      // Trigger based on notification type
      if (notification.type === "email") {
        await this.sendEmail(notification, run);
      } else if (notification.type === "webhook") {
        await this.sendWebhook(notification, run);
      }
    }
  }

  private async sendEmail(notification: Notification, run: JobRun) {
    // In a real implementation, use nodemailer or similar
    console.log(`[MOCK EMAIL] Sending to: ${notification.emailTo}`);
    console.log(`[MOCK EMAIL] Subject: ${this.interpolate(notification.emailSubject || "", run)}`);
    console.log(`[MOCK EMAIL] Body: ${this.interpolate(notification.emailBody || "", run)}`);
    
    // Simulate email sending
    return Promise.resolve();
  }

  private async sendWebhook(notification: Notification, run: JobRun, retryCount = 0): Promise<Response | undefined> {
    try {
      const url = notification.webhookUrl || "";
      const method = notification.webhookMethod || "POST";
      const headers = notification.webhookHeaders as Record<string, string> || {};
      const body = this.interpolate(notification.webhookBody || "", run);

      console.log(`[WEBHOOK] Sending ${method} to ${url}`);
      
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: method !== "GET" ? body : undefined,
      });

      if (!response.ok && retryCount < (notification.webhookRetryCount || 3)) {
        // Retry with exponential backoff
        const delay = Math.pow(2, retryCount) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.sendWebhook(notification, run, retryCount + 1);
      }

      return response;
    } catch (error: any) {
      console.error(`[WEBHOOK ERROR] ${error.message}`);
      
      if (retryCount < (notification.webhookRetryCount || 3)) {
        const delay = Math.pow(2, retryCount) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.sendWebhook(notification, run, retryCount + 1);
      }
      // Max retries exhausted — error already logged above, do not re-throw so
      // callers are not surprised by a rejection from a best-effort notification.
      return undefined;
    }
  }

  private interpolate(template: string, run: JobRun): string {
    return template
      .replace(/\{\{run\.id\}\}/g, run.id)
      .replace(/\{\{run\.status\}\}/g, run.status)
      .replace(/\{\{run\.templateId\}\}/g, run.templateId)
      .replace(/\{\{run\.startedAt\}\}/g, run.startedAt?.toString() || "N/A")
      .replace(/\{\{run\.completedAt\}\}/g, run.completedAt?.toString() || "N/A");
  }
}

export const notificationService = new NotificationService();
