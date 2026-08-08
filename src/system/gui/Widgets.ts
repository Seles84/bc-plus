export interface WidgetPosition {
    Left: number;
    Top: number;
    Width: number;
    Height: number;
}

export interface ButtonWidgetConfig {
    Name: string;
    Icon?: string | null;
    HoverText?: string;
    Active?: boolean;
}

/**
 * Draws a wide button with optional icon and returns its click handler
 * (for GUIPage.addClickHandler).
 */
export function ButtonActionWidget(pos: WidgetPosition, conf: ButtonWidgetConfig, performAction: () => void): () => void {
    const active = conf.Active ?? true;
    const color = active ? "White" : "#ddd";

    if (conf.Icon) {
        DrawButton(pos.Left, pos.Top, pos.Width, pos.Height, "", color, conf.Icon, conf.HoverText, !active);
        DrawTextFit(conf.Name, pos.Left + 90, pos.Top + pos.Height / 2, pos.Width - 100, "Black");
    } else {
        DrawButton(pos.Left, pos.Top, pos.Width, pos.Height, conf.Name, color, "", conf.HoverText, !active);
    }

    return () => {
        if (active && MouseIn(pos.Left, pos.Top, pos.Width, pos.Height)) {
            performAction();
        }
    };
}
