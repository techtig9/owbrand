// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Tabs } from '@/components/ui/Tabs';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { Avatar, Progress, Table, Td } from '@/components/ui/Display';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';

/**
 * These test the behaviour that justifies each primitive existing at all.
 *
 * A component library whose only value is consistent padding does not need
 * tests. What needs testing is the wiring every hand-rolled copy got wrong:
 * keyboard navigation, focus management, and label association.
 */

describe('Tabs', () => {
  function Harness() {
    const [value, setValue] = useState('a');
    return (
      <Tabs
        label="Report sections"
        value={value}
        onChange={setValue}
        items={[
          { id: 'a', label: 'Overview' },
          { id: 'b', label: 'Detail' },
          { id: 'c', label: 'Archived', disabled: true },
          { id: 'd', label: 'Settings' },
        ]}
      >
        <p>panel {value}</p>
      </Tabs>
    );
  }

  it('puts exactly one tab in the tab order', () => {
    render(<Harness />);
    const tabs = screen.getAllByRole('tab');

    // The roving-tabindex property. A plain button row puts all four in the
    // tab order, so reaching the panel costs four Tab presses.
    expect(tabs.filter((t) => t.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(tabs.filter((t) => t.getAttribute('tabindex') === '-1')).toHaveLength(3);
  });

  it('moves selection with arrow keys', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', { name: 'Detail' })).toHaveAttribute('aria-selected', 'true');
  });

  it('skips a disabled tab rather than landing on it', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('tab', { name: 'Detail' }));
    await user.keyboard('{ArrowRight}');

    // 'Archived' sits between Detail and Settings and is disabled.
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
  });

  it('wraps from the last enabled tab to the first', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('tab', { name: 'Settings' }));
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('jumps to first and last with Home and End', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('tab', { name: 'Detail' }));
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('links each tab to the panel it controls', () => {
    render(<Harness />);
    const selected = screen.getByRole('tab', { selected: true });
    const panel = screen.getByRole('tabpanel');

    expect(selected).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', selected.id);
  });
});

describe('Modal', () => {
  function Harness({ onClose = () => {} }: { onClose?: () => void }) {
    return (
      <Modal open title="Rename brand" description="This changes the display name only." onClose={onClose}>
        <Input label="Name" defaultValue="Acme" />
        <Button>Save</Button>
      </Modal>
    );
  }

  it('is an accessible dialog with a name', () => {
    render(<Harness />);
    const dialog = screen.getByRole('dialog');

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Rename brand');
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('traps Tab at the end of the dialog', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = screen.getByRole('dialog');

    // Walk past the last control; focus must stay inside.
    for (let i = 0; i < 6; i += 1) await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('traps Shift+Tab too — the half that forward-only traps miss', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = screen.getByRole('dialog');

    for (let i = 0; i < 6; i += 1) await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('restores background scroll on unmount', () => {
    const { unmount } = render(<Harness />);
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    // The bug this guards: a page left unscrollable forever after one dialog.
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});

describe('form fields', () => {
  it('associates the label and error with the control', () => {
    render(<Input label="Brand name" hint="Shown on invoices" error="Required" />);
    const input = screen.getByLabelText(/Brand name/);

    expect(input).toHaveAttribute('aria-invalid', 'true');
    // The error is announced, not merely coloured red.
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });

  it('describes the field by its hint when there is no error', () => {
    render(<Input label="Slug" hint="Lowercase, no spaces" />);
    expect(screen.getByLabelText('Slug')).toHaveAccessibleDescription('Lowercase, no spaces');
  });

  it('marks a required field for assistive tech, not just with an asterisk', () => {
    render(<Input label="Email" required />);
    // An asterisk alone is a glyph with no meaning attached to it.
    expect(screen.getByLabelText(/Email/)).toBeRequired();
    expect(screen.getByText('(required)')).toHaveClass('sr-only');
  });

  it('labels textarea and select the same way', () => {
    render(
      <>
        <Textarea label="Brief" />
        <Select label="Cadence">
          <option value="m">Monthly</option>
        </Select>
      </>
    );

    expect(screen.getByLabelText('Brief')).toBeInTheDocument();
    expect(screen.getByLabelText('Cadence')).toBeInTheDocument();
  });

  it('keeps a visually hidden label reachable', () => {
    render(<Input label="Search" labelHidden />);
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
  });
});

describe('Button', () => {
  it('keeps its label while loading', () => {
    render(<Button loading>Publish</Button>);
    const button = screen.getByRole('button', { name: 'Publish' });

    // Swapping the label for a spinner is the common mistake: the control
    // loses its accessible name exactly when the user needs feedback.
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('is not busy when idle', () => {
    render(<Button>Publish</Button>);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy');
  });
});

describe('Display primitives', () => {
  it('gives Progress a value in text as well as a bar', () => {
    render(<Progress label="Credits" value={250} max={1000} />);

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '250');
    expect(screen.getByText('250 / 1,000')).toBeInTheDocument();
  });

  it('clamps an out-of-range Progress value instead of overflowing the bar', () => {
    render(<Progress label="Credits" value={5000} max={1000} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1000');
  });

  it('survives a zero maximum without dividing by zero', () => {
    render(<Progress label="Credits" value={0} max={0} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '0');
  });

  it('gives an initials-only Avatar an accessible name', () => {
    render(<Avatar name="Priya Raman" />);
    expect(screen.getByText('Priya Raman')).toHaveClass('sr-only');
  });

  it('scopes every table header to its column', () => {
    render(
      <Table
        caption="Recent posts"
        columns={[
          { key: 'p', label: 'Post' },
          { key: 'r', label: 'Reach', numeric: true },
        ]}
      >
        <tr>
          <Td>Launch</Td>
          <Td numeric>1200</Td>
        </tr>
      </Table>
    );

    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(2);
    for (const header of headers) expect(header).toHaveAttribute('scope', 'col');
    expect(within(screen.getByRole('table')).getByText('Recent posts')).toBeInTheDocument();
  });
});

describe('Tooltip', () => {
  it('appears on keyboard focus, not only on hover', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Credits reset monthly">
        <button type="button">Credits</button>
      </Tooltip>
    );

    await user.tab();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Credits reset monthly');
  });

  it('describes the control instead of renaming it', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Credits reset monthly">
        <button type="button">Credits</button>
      </Tooltip>
    );

    await user.tab();
    // aria-label here would silently discard the button's own text.
    expect(screen.getByRole('button')).toHaveAccessibleName('Credits');
  });

  it('dismisses on Escape without moving focus', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Credits reset monthly">
        <button type="button">Credits</button>
      </Tooltip>
    );

    await user.tab();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveFocus();
  });
});
