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
 * Draws a titled description panel with wrapped, normal-sized text.
 * Use for hover descriptions instead of DrawButton's native tooltip,
 * which crushes long text into one unreadable line.
 */
export function DrawInfoPanel(title: string, text: string, panel: WidgetPosition): void {
    const prevAlign = MainCanvas.textAlign;
    MainCanvas.save();
    DrawRect(panel.Left, panel.Top, panel.Width, panel.Height, "#ffff88");
    DrawEmptyRect(panel.Left, panel.Top, panel.Width, panel.Height, "Black");
    MainCanvas.textAlign = "left";
    if (title) {
        DrawText(title, panel.Left + 20, panel.Top + 40, "Black");
        DrawEmptyRect(panel.Left + 15, panel.Top + 60, panel.Width - 30, 0, "Black");
    }
    const textTop = panel.Top + (title ? 80 : 20);
    DrawTextWrap(
        text,
        panel.Left + 20 - (panel.Width - 40) / 2,
        textTop,
        panel.Width - 40,
        panel.Height - (textTop - panel.Top) - 20,
        "Black",
    );
    MainCanvas.restore();
    MainCanvas.textAlign = prevAlign;
}

/**
 * Draws a wide button with optional icon and returns its click handler
 * (for GUIPage.addClickHandler). Labels are drawn left-aligned by the
 * widget itself, so the ambient canvas text-align cannot misplace them
 * (DrawButton's own label assumes centered alignment and overflows
 * otherwise).
 */
export function ButtonActionWidget(pos: WidgetPosition, conf: ButtonWidgetConfig, performAction: () => void): () => void {
    const active = conf.Active ?? true;
    const color = active ? "White" : "#ddd";

    const prevAlign = MainCanvas.textAlign;
    MainCanvas.textAlign = "left";
    DrawButton(pos.Left, pos.Top, pos.Width, pos.Height, "", color, conf.Icon || "", conf.HoverText, !active);
    const textLeft = conf.Icon ? 90 : 20;
    DrawTextFit(conf.Name, pos.Left + textLeft, pos.Top + pos.Height / 2, pos.Width - textLeft - 20, "Black");
    MainCanvas.textAlign = prevAlign;

    return () => {
        if (active && MouseIn(pos.Left, pos.Top, pos.Width, pos.Height)) {
            performAction();
        }
    };
}
