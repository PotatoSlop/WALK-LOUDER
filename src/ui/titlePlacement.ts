// Keeps the WALK_LOUDER title visible at every resolution. The game canvas uses
// Phaser Scale.FIT with a fixed 3:2 aspect, so the viewport always has letterbox
// margin on one axis — side margins on wide screens, top/bottom margins on tall
// ones. We park the title in whichever margin has room (horizontal in a top/bottom
// gap, rotated 90° in a side gap) so the scaling canvas never covers it.

const MARGIN = 12; // px breathing room required inside a gap before we use it

export function initTitlePlacement(): () => void {
    const title = document.querySelector<HTMLElement>('.title');
    if (!title) return () => {};

    let canvas: HTMLCanvasElement | null = null;
    let observer: ResizeObserver | null = null;
    let rafId = 0;

    const place = () => {
        if (!canvas || !canvas.isConnected) {
            canvas = document.querySelector<HTMLCanvasElement>('body > canvas');
        }
        if (canvas) positionTitle(title, canvas);
    };

    // The canvas is created during Phaser's boot, a beat after this runs — poll a
    // few frames until it exists, then track its size with a ResizeObserver.
    const waitForCanvas = () => {
        canvas = document.querySelector<HTMLCanvasElement>('body > canvas');
        if (canvas) {
            observer = new ResizeObserver(place);
            observer.observe(canvas);
            place();
        } else {
            rafId = requestAnimationFrame(waitForCanvas);
        }
    };

    window.addEventListener('resize', place);
    waitForCanvas();

    return () => {
        window.removeEventListener('resize', place);
        observer?.disconnect();
        cancelAnimationFrame(rafId);
    };
}

function positionTitle(title: HTMLElement, canvas: HTMLCanvasElement): void {
    const r  = canvas.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const topGap    = r.top;
    const bottomGap = vh - r.bottom;
    const leftGap   = r.left;
    const rightGap  = vw - r.right;

    // Measure the natural (unrotated) footprint before deciding on a placement.
    title.style.writingMode = 'horizontal-tb';
    title.style.transform   = 'none';
    const th = title.offsetHeight;

    if (topGap >= th + MARGIN * 2) {
        // Horizontal, centered in the top margin.
        title.style.left      = `${r.left + r.width / 2}px`;
        title.style.top       = `${topGap / 2}px`;
        title.style.transform = 'translate(-50%, -50%)';
    } else if (bottomGap >= th + MARGIN * 2) {
        // Horizontal, centered in the bottom margin.
        title.style.left      = `${r.left + r.width / 2}px`;
        title.style.top       = `${r.bottom + bottomGap / 2}px`;
        title.style.transform = 'translate(-50%, -50%)';
    } else {
        // No room above/below (the common wide-screen case) — drop the title into
        // the wider side margin, rotated 90° so its long axis runs vertically.
        const useLeft = leftGap >= rightGap;
        const cx  = useLeft ? leftGap / 2 : r.right + rightGap / 2;
        const cy  = r.top + r.height / 2;
        const deg = useLeft ? -90 : 90; // reads bottom-to-top on the left, top-to-bottom on the right
        title.style.left      = `${cx}px`;
        title.style.top       = `${cy}px`;
        title.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`;
    }
}
