package com.example.airshare

import android.content.Intent
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.widget.Toast

class AirShareTileService : TileService() {

    // Called when the user adds the tile to the Quick Settings panel
    override fun onTileAdded() {
        super.onTileAdded()
        updateTile(false)
    }

    // Called when the tile becomes visible to the user
    override fun onStartListening() {
        super.onStartListening()
        // Check if our background service is running
        updateTile(true)
    }

    // Called when the user taps on the tile
    override fun onClick() {
        super.onClick()
        val tile = qsTile
        if (tile.state == Tile.STATE_ACTIVE) {
            // Stop sharing daemon
            val intent = Intent(this, FloatingBubbleService::class.java)
            stopService(intent)
            updateTile(false)
            Toast.makeText(this, "AirShare: Daemon stopped", Toast.LENGTH_SHORT).show()
        } else {
            // Start sharing daemon in background
            val intent = Intent(this, FloatingBubbleService::class.java)
            startService(intent)
            updateTile(true)
            Toast.makeText(this, "AirShare: Daemon active, ready to bump!", Toast.LENGTH_SHORT).show()
        }
    }

    private fun updateTile(isActive: Boolean) {
        val tile = qsTile ?: return
        if (isActive) {
            tile.state = Tile.STATE_ACTIVE
            tile.label = "AirShare: Ready"
        } else {
            tile.state = Tile.STATE_INACTIVE
            tile.label = "AirShare: Off"
        }
        tile.updateTile()
    }
}
