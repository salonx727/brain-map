"use client";

// The INTAKE tab: three ways in, and what has not been filed yet.
//
// It used to render the entire AI panel underneath this list as well, so opening INTAKE
// gave you the intake buttons, the unrouted files, a divider, and then a second complete
// copy of the AI hub — engine picker, thread, composer and all. Both tabs showed the AI,
// which made the tab bar decorative and the panel twice as long as it had any reason to
// be. INTAKE is intake now.

import { useBrain } from "@/lib/brain";
import { useIntake } from "@/lib/intake";
import { deleteFileAction } from "@/app/actions/pm";

export default function IntakePanel() {
  const { model, bump, persist } = useBrain();
  const intake = useIntake();

  return (
    <div className="panelCol">
      <div className="intake">
        <button onClick={() => intake.pickPhotos("unrouted")}>
          <span className="plus">+</span>
          <span>PHOTOS</span>
        </button>
        <button onClick={() => intake.pickCamera("unrouted")}>
          <span className="plus">+</span>
          <span>CAMERA</span>
        </button>
        <button onClick={() => intake.pickFiles("unrouted")}>
          <span className="plus">+</span>
          <span>FILES</span>
        </button>
      </div>

      <div className="scrollArea">
        {!model.unrouted.length ? (
          <div className="none">Nothing waiting. Anything dropped here sits until it has a home.</div>
        ) : (
          model.unrouted.map((f, i) => (
            <div className="item" key={f.id ?? i}>
              <span>{f.name}</span>
              <button
                className="minus"
                aria-label="Remove"
                onClick={() => {
                  const prior = model.unrouted.slice();
                  model.unrouted.splice(i, 1);
                  bump();
                  if (!f.id) return;
                  persist(
                    () => deleteFileAction(f.id as string),
                    () => {
                      model.unrouted = prior;
                    },
                  );
                }}
              >
                <span />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="foot" style={{ marginTop: 14 }}>
        UNROUTED IS A STATE, NOT AN ERROR
      </div>
    </div>
  );
}
