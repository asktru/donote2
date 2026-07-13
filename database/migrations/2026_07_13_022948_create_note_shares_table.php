<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('note_shares', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('note_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('access', 8); // 'read' | 'write'
            $table->timestamps();

            $table->unique(['note_id', 'user_id']);
            $table->index('user_id');
        });

        Schema::table('notes', function (Blueprint $table) {
            // Any team member may read this note (team-public, read-only).
            $table->boolean('team_readable')->default(false)->after('folder');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('notes', function (Blueprint $table) {
            $table->dropColumn('team_readable');
        });

        Schema::dropIfExists('note_shares');
    }
};
