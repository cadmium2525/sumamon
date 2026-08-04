{
  "rules": {
    ".read": false,
    ".write": false,
    "rooms": {
      ".read": "auth != null",
      ".indexOn": ["status"],
      "$roomId": {
        ".write": "auth != null && ((!data.exists() && newData.child('hostUid').val() == auth.uid) || (data.exists() && data.child('hostUid').val() == auth.uid))",
        ".validate": "!newData.exists() || (newData.hasChildren(['roomId', 'hostUid', 'hostPeerId', 'maxPlayers', 'stageKey', 'status', 'members']) && newData.child('roomId').val() == $roomId && newData.child('hostUid').isString() && newData.child('hostPeerId').isString() && newData.child('maxPlayers').isNumber() && newData.child('maxPlayers').val() >= 2 && newData.child('maxPlayers').val() <= 4 && newData.child('stageKey').isString() && (newData.child('status').val() == 'waiting' || newData.child('status').val() == 'playing'))"
      }
    }
  }
}
