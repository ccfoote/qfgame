import { useWindowDimensions } from "@fi-sci/misc";
import "./App.css";

import nunjucks from "nunjucks";
import { FunctionComponent, useReducer, useState } from "react";
import { chatReducer, emptyChat } from "./Chat/Chat";
import ChatWindow from "./ChatWindow";

nunjucks.configure({ autoescape: false });

const openRouterKey = "sk-or" + "-v1-" + "4515b1afe37b8d66b1877e0a619840cc4561b28e4236dcc6e17a736d9171e" + "751";

function App() {
  const { width, height } = useWindowDimensions();
  const mainAreaWidth = Math.min(width - 30, 800);
  const offsetLeft = (width - mainAreaWidth) / 2;
  const [okayToViewSmallScreen, setOkayToViewSmallScreen] = useState(true);  // set to false to enable the message
  if (width < 800 && !okayToViewSmallScreen) {
    return (
      <SmallScreenMessage
        onOkay={() => setOkayToViewSmallScreen(true)}
      />
    );
  }
  return (
    <div
      style={{
        position: "absolute",
        left: offsetLeft,
        width: mainAreaWidth,
        height
      }}
    >
      <MainWindow
        width={mainAreaWidth}
        height={height}
      />
    </div>
  );
}

const MainWindow: FunctionComponent<{ width: number; height: number }> = ({ width, height }) => {
  const bottomPanelHeight = 30;
  const chatWindowHeight = height - bottomPanelHeight - 10;
  const [score, setScore] = useState(0);
  const [chat, chatDispatch] = useReducer(chatReducer, emptyChat);
  return (
    <div style={{ position: 'absolute', width, height, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', width, height: chatWindowHeight }}>
        <ChatWindow
          width={width}
          height={chatWindowHeight}
          chat={chat}
          chatDispatch={chatDispatch}
          openRouterKey={openRouterKey}
          score={score}
          setScore={setScore}
        />
      </div>
      <div style={{ position: 'absolute', left: 0, width, height: bottomPanelHeight, top: height - bottomPanelHeight, fontWeight: 'bold', fontSize: 20 }}>
        Total score: {score}
      </div>
    </div>
  )
}

const SmallScreenMessage: FunctionComponent<{ onOkay: () => void }> = ({ onOkay }) => {
  return (
    <div style={{padding: 20}}>
      <p>
        This page is not optimized for small screens or mobile devices. Please use a larger
        screen or expand your browser window width.
      </p>
      <p>
        <button onClick={onOkay}>
          I understand, continue anyway
        </button>
      </p>
    </div>
  );
}

export default App;
