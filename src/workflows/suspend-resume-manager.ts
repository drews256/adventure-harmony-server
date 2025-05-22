import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface SuspendedWorkflow {
  id: string;
  conversationId: string;
  workflowName: string;
  suspendedAt: string;
  suspendReason: string;
  context: Record<string, any>;
  userPhone: string;
  profileId: string;
  timeoutAt?: string;
}

interface ConversationMemory {
  conversationId: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
  }>;
  context: Record<string, any>;
  lastActivity: string;
}

export class SuspendResumeManager {
  private suspendedWorkflows = new Map<string, SuspendedWorkflow>();
  private conversationMemory = new Map<string, ConversationMemory>();

  // Suspend a workflow and store its context
  async suspendWorkflow(
    conversationId: string,
    workflowName: string,
    suspendReason: string,
    context: Record<string, any>,
    userPhone: string,
    profileId: string,
    timeoutMinutes: number = 60
  ): Promise<string> {
    const suspendId = `suspend_${conversationId}_${Date.now()}`;
    const timeoutAt = new Date(Date.now() + timeoutMinutes * 60 * 1000).toISOString();

    const suspendedWorkflow: SuspendedWorkflow = {
      id: suspendId,
      conversationId,
      workflowName,
      suspendedAt: new Date().toISOString(),
      suspendReason,
      context,
      userPhone,
      profileId,
      timeoutAt
    };

    this.suspendedWorkflows.set(conversationId, suspendedWorkflow);

    // Store in database for persistence
    await supabase
      .from('suspended_workflows')
      .upsert({
        id: suspendId,
        conversation_id: conversationId,
        workflow_name: workflowName,
        suspended_at: suspendedWorkflow.suspendedAt,
        suspend_reason: suspendReason,
        context: JSON.stringify(context),
        user_phone: userPhone,
        profile_id: profileId,
        timeout_at: timeoutAt
      });

    console.log(`🔄 Suspended workflow ${workflowName} for conversation ${conversationId}`);
    return suspendId;
  }

  // Resume a suspended workflow
  async resumeWorkflow(
    conversationId: string,
    newUserMessage: string
  ): Promise<{ success: boolean; context?: Record<string, any>; error?: string }> {
    const suspended = this.suspendedWorkflows.get(conversationId);
    
    if (!suspended) {
      // Try to load from database
      const { data, error } = await supabase
        .from('suspended_workflows')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('status', 'suspended')
        .single();

      if (error || !data) {
        return { success: false, error: 'No suspended workflow found' };
      }

      // Restore to memory
      const restoredWorkflow: SuspendedWorkflow = {
        id: data.id,
        conversationId: data.conversation_id,
        workflowName: data.workflow_name,
        suspendedAt: data.suspended_at,
        suspendReason: data.suspend_reason,
        context: JSON.parse(data.context),
        userPhone: data.user_phone,
        profileId: data.profile_id,
        timeoutAt: data.timeout_at
      };

      this.suspendedWorkflows.set(conversationId, restoredWorkflow);
    }

    const workflow = this.suspendedWorkflows.get(conversationId)!;

    // Check if workflow has timed out
    if (workflow.timeoutAt && new Date() > new Date(workflow.timeoutAt)) {
      await this.timeoutWorkflow(conversationId);
      return { success: false, error: 'Workflow has timed out' };
    }

    // Update conversation memory
    await this.addToConversationMemory(conversationId, {
      role: 'user',
      content: newUserMessage,
      timestamp: new Date().toISOString()
    });

    // Mark as resumed in database
    await supabase
      .from('suspended_workflows')
      .update({ 
        status: 'resumed',
        resumed_at: new Date().toISOString(),
        resume_message: newUserMessage
      })
      .eq('conversation_id', conversationId);

    // Remove from suspended workflows
    this.suspendedWorkflows.delete(conversationId);

    console.log(`✅ Resumed workflow for conversation ${conversationId}`);
    
    return { 
      success: true, 
      context: {
        ...workflow.context,
        newUserMessage,
        resumedAt: new Date().toISOString()
      }
    };
  }

  // Get suspended workflow context
  getSuspendedContext(conversationId: string): Record<string, any> | null {
    const suspended = this.suspendedWorkflows.get(conversationId);
    return suspended ? suspended.context : null;
  }

  // Check if conversation has suspended workflow
  hasSuspendedWorkflow(conversationId: string): boolean {
    return this.suspendedWorkflows.has(conversationId);
  }

  // Timeout expired workflows
  async timeoutWorkflow(conversationId: string): Promise<void> {
    const suspended = this.suspendedWorkflows.get(conversationId);
    if (!suspended) return;

    await supabase
      .from('suspended_workflows')
      .update({ 
        status: 'timed_out',
        timed_out_at: new Date().toISOString()
      })
      .eq('conversation_id', conversationId);

    this.suspendedWorkflows.delete(conversationId);
    
    // Send timeout message to user
    await this.sendTimeoutMessage(suspended.userPhone, suspended.profileId);
    
    console.log(`⏰ Workflow timed out for conversation ${conversationId}`);
  }

  // Conversation memory management
  async addToConversationMemory(
    conversationId: string, 
    message: { role: 'user' | 'assistant'; content: string; timestamp: string }
  ): Promise<void> {
    let memory = this.conversationMemory.get(conversationId);
    
    if (!memory) {
      memory = {
        conversationId,
        messages: [],
        context: {},
        lastActivity: new Date().toISOString()
      };
    }

    memory.messages.push(message);
    memory.lastActivity = new Date().toISOString();
    
    // Keep only last 50 messages to prevent memory bloat
    if (memory.messages.length > 50) {
      memory.messages = memory.messages.slice(-50);
    }

    this.conversationMemory.set(conversationId, memory);

    // Persist to database
    await supabase
      .from('conversation_memory')
      .upsert({
        conversation_id: conversationId,
        messages: JSON.stringify(memory.messages),
        context: JSON.stringify(memory.context),
        last_activity: memory.lastActivity
      });
  }

  // Get conversation history
  getConversationHistory(conversationId: string): Array<{role: 'user' | 'assistant'; content: string; timestamp: string}> {
    const memory = this.conversationMemory.get(conversationId);
    return memory ? memory.messages : [];
  }

  // Update conversation context
  async updateConversationContext(conversationId: string, context: Record<string, any>): Promise<void> {
    let memory = this.conversationMemory.get(conversationId);
    
    if (!memory) {
      memory = {
        conversationId,
        messages: [],
        context: {},
        lastActivity: new Date().toISOString()
      };
    }

    memory.context = { ...memory.context, ...context };
    memory.lastActivity = new Date().toISOString();
    
    this.conversationMemory.set(conversationId, memory);
  }

  // Cleanup old conversations and workflows
  async cleanup(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

    // Cleanup suspended workflows
    for (const [conversationId, workflow] of this.suspendedWorkflows.entries()) {
      if (workflow.timeoutAt && new Date(workflow.timeoutAt) < cutoff) {
        await this.timeoutWorkflow(conversationId);
      }
    }

    // Cleanup old conversation memory
    for (const [conversationId, memory] of this.conversationMemory.entries()) {
      if (new Date(memory.lastActivity) < cutoff) {
        this.conversationMemory.delete(conversationId);
      }
    }

    console.log('🧹 Completed cleanup of old workflows and conversations');
  }

  private async sendTimeoutMessage(userPhone: string, profileId: string): Promise<void> {
    // This would integrate with SMS tool to send timeout notification
    console.log(`📱 Would send timeout message to ${userPhone}`);
  }

  // Get all suspended workflows (for monitoring)
  getAllSuspendedWorkflows(): SuspendedWorkflow[] {
    return Array.from(this.suspendedWorkflows.values());
  }
}

export const suspendResumeManager = new SuspendResumeManager();