export const SHADOW_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }

  /* Floating Icon */
  .bambooink-icon {
    position: fixed;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: #15803D;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    pointer-events: auto;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    user-select: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .bambooink-icon:hover {
    transform: scale(1.1);
    box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  }
  .bambooink-icon svg {
    width: 22px;
    height: 22px;
  }
  .bambooink-badge {
    position: absolute;
    top: -5px;
    right: -5px;
    min-width: 16px;
    height: 16px;
    border-radius: 8px;
    background: #DC2626;
    color: white;
    font-size: 9px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 3px;
    pointer-events: none;
  }
  .bambooink-icon.loading {
    animation: bambooink-pulse 1.5s ease-in-out infinite;
  }
  @keyframes bambooink-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  /* Suggestions Panel */
  .bambooink-panel {
    pointer-events: auto;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: white;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.1);
    overflow: hidden;
    max-width: 340px;
    min-width: 280px;
    border: 1px solid #e5e7eb;
    position: fixed;
  }
  .bambooink-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: #15803D;
    color: white;
    font-size: 13px;
    font-weight: 600;
  }
  .bambooink-panel-close {
    cursor: pointer;
    font-size: 16px;
    opacity: 0.8;
    background: none;
    border: none;
    color: white;
    padding: 0 2px;
  }
  .bambooink-panel-close:hover { opacity: 1; }
  .bambooink-panel-body {
    max-height: 300px;
    overflow-y: auto;
  }
  .bambooink-no-issues {
    padding: 16px 14px;
    text-align: center;
    color: #6b7280;
    font-size: 13px;
  }
  .bambooink-no-issues .check {
    color: #15803D;
    font-size: 24px;
    display: block;
    margin-bottom: 6px;
  }

  /* Issue Row */
  .bambooink-issue {
    padding: 10px 14px;
    border-bottom: 1px solid #f3f4f6;
  }
  .bambooink-issue:last-child { border-bottom: none; }
  .bambooink-issue-type {
    display: inline-block;
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
    margin-bottom: 4px;
  }
  .type-spelling { background: #FEE2E2; color: #DC2626; }
  .type-grammar { background: #FEF3C7; color: #D97706; }
  .type-tone { background: #E0E7FF; color: #4F46E5; }
  .type-clarity { background: #E0F2FE; color: #0284C7; }
  .bambooink-original {
    text-decoration: line-through;
    color: #9ca3af;
    font-size: 13px;
  }
  .bambooink-arrow { color: #9ca3af; margin: 0 4px; font-size: 12px; }
  .bambooink-suggestion {
    color: #15803D;
    font-weight: 600;
    font-size: 13px;
  }
  .bambooink-explanation {
    font-size: 11px;
    color: #6b7280;
    margin-top: 4px;
  }
  .bambooink-alternatives {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }
  .bambooink-alt-btn {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid #d1d5db;
    background: #f9fafb;
    color: #374151;
    cursor: pointer;
    font-weight: 500;
    font-family: inherit;
  }
  .bambooink-alt-btn:hover {
    background: #15803D;
    color: white;
    border-color: #15803D;
  }
  .bambooink-actions {
    display: flex;
    gap: 6px;
    margin-top: 6px;
  }
  .bambooink-btn {
    font-size: 11px;
    padding: 3px 10px;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    font-weight: 500;
  }
  .bambooink-btn-accept {
    background: #15803D;
    color: white;
  }
  .bambooink-btn-accept:hover { background: #16A34A; }
  .bambooink-btn-dismiss {
    background: #f3f4f6;
    color: #6b7280;
  }
  .bambooink-btn-dismiss:hover { background: #e5e7eb; }

`;
