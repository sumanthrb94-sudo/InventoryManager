"""Draw a box diagram of the production-hardened Returns workflow."""

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

fig, ax = plt.subplots(figsize=(16, 12))
ax.set_xlim(0, 16)
ax.set_ylim(0, 12)
ax.axis('off')

# Palette
colors = {
    'page': '#dbeafe',      # blue-100
    'modal': '#fef3c7',     # amber-100
    'queue': '#fde68a',     # amber-200
    'action': '#d1fae5',    # emerald-100
    'guard': '#fee2e2',     # red-100
    'db': '#e0e7ff',        # indigo-100
    'role': '#f3e8ff',      # purple-100
}

def box(x, y, w, h, text, color, fontsize=9, bold=False):
    style = "round,pad=0.02,rounding_size=0.15"
    patch = FancyBboxPatch((x, y), w, h, boxstyle=style, facecolor=color, edgecolor='#374151', linewidth=1.5)
    ax.add_patch(patch)
    weight = 'bold' if bold else 'normal'
    ax.text(x + w/2, y + h/2, text, ha='center', va='center', fontsize=fontsize, weight=weight, wrap=True)
    return patch

def arrow(x1, y1, x2, y2, color='#374151'):
    ax.annotate('', xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle='->', color=color, lw=1.5))

# Title
ax.text(8, 11.5, 'Returns Section — Box Diagram', ha='center', va='center', fontsize=18, weight='bold')

# Top: Returns Page
box(6, 10, 4, 0.8, 'Returns Page\n(sold units list)', colors['page'], fontsize=11, bold=True)

# Left branch: Tech-QC intake
arrow(7, 10, 3.5, 9.2)
box(1.5, 8.4, 4, 0.8, 'Tech / QC Intake Modal\nrecordReturnQc()', colors['modal'], fontsize=10, bold=True)
arrow(3.5, 8.4, 3.5, 7.6)
box(1.5, 6.8, 4, 0.8, 'Pending CRM Review\npendingCrmReview = true', colors['queue'], fontsize=10, bold=True)

# Right branch: Quick repair shortcut
arrow(9, 10, 12, 9.2)
box(11, 8.4, 4, 0.8, 'Quick Repair Shortcut\nquickRepair()', colors['modal'], fontsize=10, bold=True)
arrow(13, 8.4, 13, 7.6)
box(11, 6.5, 4, 1.1, 'Unit → returned\nreturnType = repair\nVoid sale: voidOutcome = repair', colors['action'], fontsize=9, bold=True)

# Center: Process Return Modal
arrow(3.5, 6.8, 6, 6.0)
box(5.5, 5.2, 5, 0.8, 'Process Return Modal\nprocessReturn()', colors['modal'], fontsize=11, bold=True)

# Three outcomes
arrow(6.5, 5.2, 3, 4.4)
box(1, 3.6, 4, 0.8, 'Refund', colors['action'], fontsize=10, bold=True)

arrow(8, 5.2, 8, 4.4)
box(6, 3.6, 4, 0.8, 'Replacement', colors['action'], fontsize=10, bold=True)

arrow(9.5, 5.2, 13, 4.4)
box(11, 3.6, 4, 0.8, 'Repair', colors['action'], fontsize=10, bold=True)

# Refund detail
arrow(3, 3.6, 3, 2.8)
box(0.5, 1.8, 5, 0.9, "Unit → 'available'\nreturnOutcome = 'refund'\nClear sale fields\nVoid sale: voidOutcome = 'refund'", colors['action'], fontsize=8)

# Replacement detail
arrow(8, 3.6, 8, 2.8)
box(5.5, 1.6, 5, 1.1, "Returning unit → 'available'\nreplacedByUnitId = repl.id\nReplacement unit → 'sold'\nreplacementForUnitId = orig.id\nVoid sale: voidOutcome = 'replacement'", colors['action'], fontsize=8)

# Repair detail
arrow(13, 3.6, 13, 2.8)
box(10.5, 1.8, 5, 0.9, "Unit → 'returned'\nreturnType = 'repair'\nVoid sale: voidOutcome = 'repair'", colors['action'], fontsize=8)

# Repair queue / ready to ship
arrow(13, 1.8, 13, 1.2)
box(10.5, 0.3, 5, 0.9, 'Repair Queue / Ready to Ship\ncompleteRepair() → available + repaired_unit flag', colors['queue'], fontsize=9, bold=True)

# Atomic transaction guard (right side)
box(11, 10.6, 4.5, 0.7, 'Atomic Firestore Transaction\nrunTransaction()', colors['guard'], fontsize=9, bold=True)
arrow(13.25, 10.6, 13.25, 9.6)

# Guard box
box(11, 9.3, 4.5, 1.3, 'Concurrency Guards\n• Returning unit must still be "sold"\n• Replacement unit must still be "available"\n• All updates commit or all abort', colors['guard'], fontsize=8)

# Role gating box
box(0.5, 10.6, 4.5, 0.7, 'Role Gating', colors['role'], fontsize=10, bold=True)
arrow(2.75, 10.6, 2.75, 9.6)
box(0.5, 9.3, 4.5, 1.3, 'Returns fields / voids\nrequire returns-manager\nor admin role\n(Firestore rules + isReturnsManager)', colors['role'], fontsize=8)

# Legend
legend_items = [
    ('Page / Screen', colors['page']),
    ('Modal / Service call', colors['modal']),
    ('Queue state', colors['queue']),
    ('Outcome / status change', colors['action']),
    ('Guard / transaction', colors['guard']),
    ('Role gate', colors['role']),
]
for i, (label, color) in enumerate(legend_items):
    x = 0.5 + i * 2.5
    rect = mpatches.Rectangle((x, -0.8), 0.4, 0.3, facecolor=color, edgecolor='#374151')
    ax.add_patch(rect)
    ax.text(x + 0.55, -0.65, label, va='center', fontsize=8)

plt.tight_layout()
plt.savefig('docs/returns-workflow-diagram.png', dpi=150, bbox_inches='tight', facecolor='white')
print('Saved docs/returns-workflow-diagram.png')
