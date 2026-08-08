/** Shows a beep-style info notification in the top-left corner of the club. */
export function InfoBeep(message: string, duration: number = 4000): void {
    ServerShowBeep(message, duration, { silent: true });
}
