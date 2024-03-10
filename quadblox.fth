\ Falling block puzzle game
8 constant block_size
4 constant well_x_offs
4 constant well_y_offs
10 constant well_width
15 constant well_height

\ Each piece consits of four blocks. Each block is stored here
\ as an X and Y offset from the pivot point.
create piece_l 0 , -1 , 0 , 0 , 0 , 1 , 1 , 1 ,
create piece_j 0 , -1 , 0 , 0 , 0 , 1 , -1 , 1 ,
create piece_i 0 , -2 , 0 , -1 , 0 , 0 , 0 , 1 ,
create piece_t -1 , 0 , 0 , 0 , 1 , 0 , 0 , 1 ,
create piece_o 0 , 0 , 1 , 0 , 1 , 1 , 0 , 1 ,
create piece_s -1 , 1 , 0 , 1 , 0 , 0 , 1 , 0 ,
create piece_z 1 , 1 , 0 , 1 , 0 , 0 , -1 , 0 ,
create pieces piece_l , piece_j , piece_i , piece_t , piece_o , piece_s , piece_z ,

\ Track which blocks in the well have pieces in them. This only tracks pieces
\ that have fallen in the well, not the currently dropping pieces.
create well_data well_width well_height * cells allot

\ Score increment for number of rows cleared.
create score_table 40 , 100 , 300 , 1200 ,
variable score

\ Information about currently dropping piece.
variable piece_x
variable piece_y
variable cur_shape
variable shape_color
variable rotation

: ++
    dup @ 1 + swap !
;

: --
    dup @ 1 - swap !
;

\ Given an X and Y coordinate, rotate it according to current piece
\ rotation.
( x y -- x y )
: rotate
    rotation @ 1 = if
        \ x = y y = -x
        swap
        negate
    then
    rotation @ 2 = if
        \ x = -x  y = -y
        negate
        swap
        negate
        swap
    then
    rotation @ 3 = if
        \ x = -y y = x
        negate
        swap
    then
;

( piece_addr -- piece_addr )
: draw_block
    dup @      \ Read X
    over 4 + @ \ Read Y

    rotate

    \ Convert to screen locations
    piece_y @ + block_size * well_y_offs +
    swap
    piece_x @ + block_size * well_x_offs +
    swap

    7 7 fill_rect
;

: draw_piece
    cur_shape @
    draw_block 8 +
    draw_block 8 +
    draw_block 8 +
    draw_block
    drop
;

\ Given piece addr translate and rotate to
\ coords in grid
( piece_addr -- x y )
: transform_block_coords
    dup @      \ Read X
    over 4 + @ \ Read Y

    rotate

    \ Convert to screen locations
    piece_y @ +
    swap
    piece_x @ +
    swap
;

: lock_block
    transform_block_coords

    well_width * + cells \ Convert to array offset
    well_data +

    shape_color @ swap !
;

\ When a piece cannot fall any more, copy its blocks
\ into the well grid.
: lock_piece
    cur_shape @
    lock_block 8 +
    lock_block 8 +
    lock_block 8 +
    lock_block
    drop
;

variable collision

: block_collides
    transform_block_coords

    ( x y )
    \ Check in bounds
    dup 0 < if
        1 collision !
        drop drop
        exit
    then

    dup well_height >= if
        1 collision !
        drop drop
        exit
    then

    swap

    dup 0 < if
        1 collision !
        drop drop
        exit
    then

    dup well_width >= if
        1 collision !
        drop drop
        exit
    then

    swap
    well_width * + cells \ Convert to array offset
    well_data +
    @  \ Read
    if
        1 collision !
    then
;

: piece_collides
    0 collision !
    cur_shape @
    block_collides 8 +
    block_collides 8 +
    block_collides 8 +
    block_collides
    drop
    collision @
;

variable drop_timer

: new_piece
    random 7 mod
    dup

    1 + shape_color !

    cells pieces + @
    cur_shape !

    4 piece_x !
    2 piece_y !
;

variable x
variable y
variable blink_state
variable blink_counter
create finished_rows well_height cells allot

: draw_well
    \ Draw the well sides
    7 set_color
    3 3 84 3 draw_line
    3 3 3 124 draw_line
    84 3 84 124 draw_line
    3 124 84 124 draw_line

    \ Draw locked pieces inside well
    0 y !
    begin
        y @ well_height <
    while
        \ If this row is finished, it will blink before being removed.
        \ Check if the row is blinking before drawing
        y @ cells finished_rows + @   ( Is this row set as finished )
        blink_state @ and             ( and we are the hide phase )
        0= if
            0 x !
            begin
                x @ well_width <
            while
                y @ well_width * x @ + cells well_data + @  \ read well block
                dup if
                    set_color

                    x @ block_size * well_x_offs +
                    y @ block_size * well_y_offs +
                    7 7 fill_rect
                else
                    drop
                then

                x ++
            repeat
        then
        y ++
    repeat
;

variable finished_row_count
variable row_is_finished

\ Check if any rows have all of their columns filled and
\ need to disappear.
: check_finished
    well_height finished_rows zero_memory

    0 finished_row_count !
    0 y !
    begin
        y @ well_height <
    while
        1 row_is_finished !
        0 x !
        begin
            x @ well_width <
        while
            y @ well_width * x @ + cells well_data + @
            0= if
                0 row_is_finished !
            then

            x ++
        repeat

        row_is_finished @ if
            1 y @ cells finished_rows + !
            finished_row_count ++
        then

        y ++
    repeat

    finished_row_count @
;

variable dest_y

\ Copy rows down to fill spaces left by rows that have been completed.
: remove_finished_rows
    \ Walk from bottom up
    well_height 1 -
    dup
    y !  \ Y is source address
    dest_y !

    begin
        y @ 0 >=
    while
        y @ cells finished_rows + @   ( Is this row set as finished )
        0= if
            \ Not eliminated, copy
            y @ well_width * cells well_data +  \ src
            dest_y @ well_width * cells well_data +  \ dest
            well_width \ count
            copy
            dest_y --
        then

        y --
    repeat

    \ Clear rows at top that are now exposed.
    dest_y @ well_width * cells
    well_data
    zero_memory
;

variable button_mask

: check_buttons
    \ We only take action when the button transition
    \ from not pressed to pressed, so check if the button state
    \ has changed from the last sample.
    buttons dup                 ( buttons buttons )
    button_mask @ -1 xor and    ( ~button_mask & buttons )
    swap button_mask !          ( update button msak)
;

variable drop_delay
variable game_over

\ We check if the movement is legal by first moving to the new
\ position and then checking if pieces are either out of bounds
\ or intersecting existing blocks. If so, we undo the movement.
: move_piece
    check_buttons

    \ top of stack is now buttons that have been pressed
    \ Check left
    dup button_l and piece_x @ 0 > and if
        piece_x @ 1 - piece_x !
        piece_collides if
            \ Collision, undo action
            piece_x @ 1 + piece_x !
        then
    then

    \ Check right
    dup button_r and if
        piece_x @ well_width < if
            piece_x @ 1 + piece_x !
            piece_collides if
                \ Collision, undo action
                piece_x @ 1 - piece_x !
            then
        then
    then

    \ Check up button, which rotates the piece.
    button_u and if
        rotation @ 1 + 3 and rotation !
        piece_collides if
            \ Collision, undo action
            rotation @ 3 + 3 and rotation !
        then
    then

    \ Check down button, which speeds up the descent.
    \ Unlike the others, this can be held
    buttons button_d and if
        drop_timer ++
    then

    \ Handle falling
    drop_timer ++
    drop_timer @ drop_delay @ >= if
        0 drop_timer !
        piece_y @ 1 + piece_y !
        piece_collides if
            \ Hit bottom and can no longer fall.
            piece_y @ 1 - piece_y ! \ Restore to place before collision
            lock_piece
            check_finished dup if
                \ Update score based on number of lines cleared
                cells score_table + 1 - @
                score @ + score !
                score @ . \ print it for now (we can't draw text yet)

                \ Kick off animation. We don't add the new piece here because
                \ we need to wait for the animation to finish.
                1 blink_counter !
            else
                drop \ Clear extra finished line count

                \ carry on
                new_piece
                piece_collides if
                    1 game_over !
                then
            then
        then
    then
;

: init_game
    0 game_over !
    20 drop_delay !
    0 drop_timer !

    \ Clear the well data structure
    well_width well_height *
    well_data
    zero_memory

    well_width finished_rows zero_memory

    new_piece

    0 score !
;

: draw_frame
    game_over @ if
        \ User can press a button to restart
        check_buttons if
            init_game
        then
    else
        blink_counter @ if
            \ Peforming a blink animation sequence to remove rows.
            blink_counter ++
            blink_counter @ 6 / 1 and 0= blink_state !

            \ Check if the animation sequence is finished.
            blink_counter @ 30 > if
                \ yes, so remove rows and start game again.
                new_piece
                piece_collides if
                    1 game_over !
                then
                remove_finished_rows
                0 blink_counter !
            then
        else
            move_piece
        then
    then


    \ Draw
    0 cls

    draw_well

    \ Draw the currently falling piece
    shape_color @ set_color
    blink_counter @ 0= if
        draw_piece
    then
;

init_game
