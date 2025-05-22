import { MCPTool } from './goguide-api';

export interface HelpToolArgs {
  conversationSummary: string;
  specificIssue?: string;
  urgency?: 'low' | 'medium' | 'high';
  userContext?: string;
}

/**
 * Help tool for generating human assistance requests from conversation summaries
 */
export class HelpTool {
  private supabase;
  
  constructor(supabase: any) {
    this.supabase = supabase;
  }

  /**
   * Generate a professional help request HTML page
   */
  private generateHelpRequestHTML(args: HelpToolArgs, helpId: string): string {
    const urgencyColors = {
      low: '#10b981',
      medium: '#f59e0b', 
      high: '#ef4444'
    };
    
    const urgencyColor = urgencyColors[args.urgency || 'medium'];
    const currentDate = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Help Request - Adventure Harmony Planner</title>
    <style>
        :root {
            --primary-color: #2563eb;
            --primary-dark: #1d4ed8;
            --secondary-color: #f1f5f9;
            --text-primary: #0f172a;
            --text-secondary: #64748b;
            --border-color: #e2e8f0;
            --shadow-light: 0 1px 3px rgba(0, 0, 0, 0.05);
            --shadow-medium: 0 4px 6px rgba(0, 0, 0, 0.07);
            --shadow-large: 0 10px 25px rgba(0, 0, 0, 0.1);
            --urgency-color: ${urgencyColor};
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, sans-serif;
            background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
            color: var(--text-primary);
            line-height: 1.6;
            min-height: 100vh;
            animation: fadeIn 0.6s ease-out;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .header {
            background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-dark) 100%);
            color: white;
            padding: 2rem 1rem;
            text-align: center;
            position: relative;
            overflow: hidden;
        }
        
        .header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="0.5"/></pattern></defs><rect width="100" height="100" fill="url(%23grid)"/></svg>');
            opacity: 0.3;
        }
        
        .header h1 {
            font-size: 2rem;
            font-weight: 700;
            letter-spacing: -0.025em;
            position: relative;
            z-index: 1;
            margin-bottom: 0.5rem;
        }
        
        .header .subtitle {
            font-size: 1.1rem;
            opacity: 0.9;
            position: relative;
            z-index: 1;
        }
        
        .container {
            max-width: 800px;
            margin: -1rem auto 2rem;
            padding: 0 1rem;
            position: relative;
            z-index: 10;
        }
        
        .help-card {
            background: white;
            border-radius: 16px;
            box-shadow: var(--shadow-large);
            overflow: hidden;
            border: 1px solid var(--border-color);
            animation: slideUp 0.7s ease-out 0.2s both;
        }
        
        @keyframes slideUp {
            from { opacity: 0; transform: translateY(30px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .urgency-banner {
            background: var(--urgency-color);
            color: white;
            padding: 0.75rem 1.5rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            font-size: 0.875rem;
        }
        
        .content {
            padding: 2rem;
        }
        
        .meta-info {
            background: var(--secondary-color);
            border-radius: 8px;
            padding: 1rem;
            margin-bottom: 2rem;
            border-left: 4px solid var(--primary-color);
        }
        
        .meta-info h3 {
            color: var(--text-primary);
            font-size: 0.875rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 0.5rem;
        }
        
        .meta-info p {
            color: var(--text-secondary);
            font-size: 0.875rem;
        }
        
        .section {
            margin-bottom: 2rem;
        }
        
        .section h2 {
            color: var(--text-primary);
            font-size: 1.25rem;
            font-weight: 600;
            margin-bottom: 1rem;
            padding-bottom: 0.5rem;
            border-bottom: 2px solid var(--secondary-color);
        }
        
        .conversation-summary {
            background: #f8fafc;
            border-radius: 8px;
            padding: 1.5rem;
            border: 1px solid var(--border-color);
            white-space: pre-wrap;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace;
            font-size: 0.9rem;
            line-height: 1.6;
            max-height: 400px;
            overflow-y: auto;
        }
        
        .issue-highlight {
            background: #fef3c7;
            border: 1px solid #f59e0b;
            border-radius: 8px;
            padding: 1rem;
            color: #92400e;
            font-weight: 500;
        }
        
        .user-context {
            background: #ecfdf5;
            border: 1px solid #10b981;
            border-radius: 8px;
            padding: 1rem;
            color: #065f46;
        }
        
        .action-buttons {
            display: flex;
            gap: 1rem;
            margin-top: 2rem;
            flex-wrap: wrap;
        }
        
        .btn {
            padding: 0.75rem 1.5rem;
            border-radius: 8px;
            font-weight: 600;
            text-decoration: none;
            transition: all 0.2s ease;
            cursor: pointer;
            border: none;
            font-size: 0.875rem;
        }
        
        .btn-primary {
            background: var(--primary-color);
            color: white;
        }
        
        .btn-primary:hover {
            background: var(--primary-dark);
            transform: translateY(-1px);
            box-shadow: var(--shadow-medium);
        }
        
        .btn-secondary {
            background: white;
            color: var(--text-primary);
            border: 1px solid var(--border-color);
        }
        
        .btn-secondary:hover {
            background: var(--secondary-color);
            transform: translateY(-1px);
            box-shadow: var(--shadow-medium);
        }
        
        .footer {
            text-align: center;
            padding: 2rem;
            color: var(--text-secondary);
            font-size: 0.875rem;
            background: rgba(255, 255, 255, 0.7);
            border-top: 1px solid var(--border-color);
        }
        
        @media (max-width: 768px) {
            .header {
                padding: 1.5rem 1rem;
            }
            
            .header h1 {
                font-size: 1.5rem;
            }
            
            .container {
                margin: -0.5rem auto 1rem;
                padding: 0 0.75rem;
            }
            
            .content {
                padding: 1.5rem;
            }
            
            .action-buttons {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🆘 Help Request</h1>
        <div class="subtitle">Adventure Harmony Planner - Human Assistance Needed</div>
    </div>
    
    <div class="container">
        <div class="help-card">
            <div class="urgency-banner">
                ${args.urgency || 'medium'} Priority Request
            </div>
            
            <div class="content">
                <div class="meta-info">
                    <h3>Request Details</h3>
                    <p><strong>Request ID:</strong> ${helpId}</p>
                    <p><strong>Generated:</strong> ${currentDate}</p>
                    <p><strong>System:</strong> Adventure Harmony Planner AI Assistant</p>
                </div>
                
                <div class="section">
                    <h2>📋 Conversation Summary</h2>
                    <div class="conversation-summary">${this.escapeHtml(args.conversationSummary)}</div>
                </div>
                
                ${args.specificIssue ? `
                <div class="section">
                    <h2>⚠️ Specific Issue</h2>
                    <div class="issue-highlight">${this.escapeHtml(args.specificIssue)}</div>
                </div>
                ` : ''}
                
                ${args.userContext ? `
                <div class="section">
                    <h2>👤 User Context</h2>
                    <div class="user-context">${this.escapeHtml(args.userContext)}</div>
                </div>
                ` : ''}
                
                <div class="action-buttons">
                    <button class="btn btn-primary" onclick="copyToClipboard()">📋 Copy Summary</button>
                    <button class="btn btn-secondary" onclick="print()">🖨️ Print Request</button>
                    <a href="mailto:support@adventureharmony.com?subject=Help Request ${helpId}&body=${encodeURIComponent('Help Request ID: ' + helpId + '\\n\\nSummary: ' + args.conversationSummary)}" class="btn btn-secondary">📧 Email Support</a>
                </div>
            </div>
            
            <div class="footer">
                This help request was generated automatically by the Adventure Harmony AI system.<br>
                A human will review this request and provide assistance as soon as possible.
            </div>
        </div>
    </div>
    
    <script>
        function copyToClipboard() {
            const summary = \`Help Request ID: ${helpId}
Generated: ${currentDate}

Conversation Summary:
${args.conversationSummary}${args.specificIssue ? '\\n\\nSpecific Issue:\\n' + args.specificIssue : ''}${args.userContext ? '\\n\\nUser Context:\\n' + args.userContext : ''}\`;
            
            navigator.clipboard.writeText(summary).then(() => {
                const btn = event.target;
                const originalText = btn.textContent;
                btn.textContent = '✅ Copied!';
                btn.style.background = '#10b981';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.style.background = '';
                }, 2000);
            }).catch(() => {
                alert('Summary copied to clipboard manually. Please paste where needed.');
            });
        }
        
        // Auto-fade in animation
        document.addEventListener('DOMContentLoaded', function() {
            document.body.style.opacity = '1';
        });
    </script>
</body>
</html>`;
  }

  /**
   * Escape HTML characters for safe display
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\n/g, '<br>');
  }

  /**
   * Create help request and return hosted link
   */
  async createHelpRequest(args: HelpToolArgs): Promise<{ url: string; helpId: string }> {
    try {
      // Generate unique help request ID
      const helpId = `help_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
      
      // Generate HTML
      const html = this.generateHelpRequestHTML(args, helpId);
      
      // Store help request in database
      const { error } = await this.supabase
        .from('help_requests')
        .insert({
          id: helpId,
          conversation_summary: args.conversationSummary,
          specific_issue: args.specificIssue,
          urgency: args.urgency || 'medium',
          user_context: args.userContext,
          html_content: html,
          status: 'pending',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      
      if (error) {
        // If table doesn't exist, continue anyway and just return the URL
        console.warn('Help requests table may not exist:', error.message);
      }
      
      // Return the hosted URL
      const baseUrl = process.env.BASE_URL || 'https://adventure-harmony-09bcd11c3365.herokuapp.com';
      return {
        url: `${baseUrl}/help/${helpId}`,
        helpId
      };
      
    } catch (error) {
      throw new Error(`Help request creation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get help request HTML by ID
   */
  async getHelpRequestHTML(helpId: string): Promise<string | null> {
    try {
      const { data, error } = await this.supabase
        .from('help_requests')
        .select('html_content')
        .eq('id', helpId)
        .single();
      
      if (error || !data) {
        return null;
      }
      
      return data.html_content;
    } catch (error) {
      console.error('Error fetching help request HTML:', error);
      return null;
    }
  }

  /**
   * Get MCP tool definition
   */
  static getToolDefinition(): MCPTool {
    return {
      name: 'HelpMe_CreateRequest',
      description: 'Creates a professional help request page that summarizes the conversation and asks for human assistance',
      inputSchema: {
        type: 'object',
        properties: {
          conversationSummary: {
            type: 'string',
            description: 'A comprehensive summary of the conversation, including what was attempted and what issues occurred'
          },
          specificIssue: {
            type: 'string',
            description: 'Optional specific issue or error that needs human attention'
          },
          urgency: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'Priority level for the help request (defaults to medium)'
          },
          userContext: {
            type: 'string',
            description: 'Optional additional context about the user or situation'
          }
        },
        required: ['conversationSummary']
      }
    };
  }
}